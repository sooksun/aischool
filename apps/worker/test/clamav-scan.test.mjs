// Malware scanning (ADR-0009) — the clamd protocol client and the fail-closed rule.
//
// The most important test in this file is not "it detects EICAR". It is
// "a scanner that cannot be reached does NOT produce a clean verdict". That is
// the lesson CCR-012 was written from — the previous scanner returned `clean`
// for everything it did not recognise by filename — expressed as an assertion so
// it cannot quietly come back.
//
// The clamd side is a real TCP server speaking the real INSTREAM protocol rather
// than a mock of our own client: a mock would only prove the code agrees with
// itself. Tests that need actual signature detection are marked and skipped
// unless a real clamd is reachable (CLAMAV_HOST), because pulling 250 MB of
// signatures into every CI run to detect one known string is a poor trade.
process.env.NODE_ENV = 'test';

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { Readable } from 'node:stream';
import { scanStream, pingClamAv, ScanUnavailableError } from '../dist/clamav.js';

/**
 * A minimal clamd that speaks INSTREAM and answers however the test wants.
 * `reply` may be a string, or 'hangup' to close without replying.
 */
// Every helper server tracks its accepted sockets. `server.close()` only stops
// accepting — it then waits for live connections to end, so a test whose server
// is deliberately silent would hang the whole file (it did, for 90s, before this).
function trackSockets(server) {
  server.__sockets = new Set();
  server.on('connection', (s) => {
    server.__sockets.add(s);
    s.on('close', () => server.__sockets.delete(s));
  });
  return server;
}

function fakeClamd(reply) {
  const server = net.createServer((socket) => {
    let sawTerminator = false;
    let buffered = Buffer.alloc(0);

    socket.on('data', (chunk) => {
      buffered = Buffer.concat([buffered, chunk]);
      // A zero-length chunk header ends the stream. Good enough to know the
      // client finished: the four trailing zero bytes.
      if (buffered.length >= 4 && buffered.subarray(-4).equals(Buffer.alloc(4))) {
        sawTerminator = true;
      }
      if (buffered.includes('zPING')) {
        socket.end('PONG\0');
        return;
      }
      if (sawTerminator) {
        if (reply === 'hangup') socket.end();
        else socket.end(`${reply}\0`);
      }
    });
  });
  return trackSockets(server);
}

function listen(server) {
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
}

function close(server) {
  for (const s of server.__sockets ?? []) s.destroy();
  return new Promise((resolve) => server.close(resolve));
}

function bodyOf(text) {
  return Readable.from([Buffer.from(text)]);
}

const REAL_CLAMD = process.env.CLAMAV_HOST
  ? { host: process.env.CLAMAV_HOST, port: Number(process.env.CLAMAV_PORT ?? 3310), timeoutMs: 30_000 }
  : null;

// ── the rule ──

test('a scanner that refuses the connection NEVER yields clean', async () => {
  // Port 1 on loopback: nothing listens, connection is refused immediately.
  await assert.rejects(
    () => scanStream(bodyOf('anything'), { host: '127.0.0.1', port: 1, timeoutMs: 2_000 }),
    ScanUnavailableError,
    'unreachable must be an error, never a verdict — the file stays pending and undownloadable',
  );
});

test('a scanner that hangs up without replying NEVER yields clean', async () => {
  const server = fakeClamd('hangup');
  const port = await listen(server);
  try {
    await assert.rejects(
      () => scanStream(bodyOf('anything'), { host: '127.0.0.1', port, timeoutMs: 2_000 }),
      ScanUnavailableError,
    );
  } finally {
    await close(server);
  }
});

test('a scanner that replies ERROR NEVER yields clean', async () => {
  // Includes clamd's real "INSTREAM size limit exceeded" reply: refusing to scan
  // is not a clean bill of health.
  const server = fakeClamd('INSTREAM size limit exceeded. ERROR');
  const port = await listen(server);
  try {
    await assert.rejects(
      () => scanStream(bodyOf('x'.repeat(100)), { host: '127.0.0.1', port, timeoutMs: 2_000 }),
      ScanUnavailableError,
    );
  } finally {
    await close(server);
  }
});

test('a scanner that never answers times out rather than pinning the worker forever', async () => {
  const silent = trackSockets(net.createServer(() => { /* accept and say nothing */ }));
  const port = await listen(silent);
  try {
    const started = Date.now();
    await assert.rejects(
      () => scanStream(bodyOf('x'), { host: '127.0.0.1', port, timeoutMs: 300 }),
      ScanUnavailableError,
    );
    assert.ok(Date.now() - started < 5_000, 'must give up on its own deadline');
  } finally {
    await close(silent);
  }
});

// ── the protocol ──

test('OK is parsed as clean', async () => {
  const server = fakeClamd('stream: OK');
  const port = await listen(server);
  try {
    const verdict = await scanStream(bodyOf('harmless'), { host: '127.0.0.1', port, timeoutMs: 2_000 });
    assert.deepEqual(verdict, { status: 'clean' });
  } finally {
    await close(server);
  }
});

test('FOUND is parsed as infected, and the signature name is kept', async () => {
  const server = fakeClamd('stream: Win.Test.EICAR_HDB-1 FOUND');
  const port = await listen(server);
  try {
    const verdict = await scanStream(bodyOf('bad'), { host: '127.0.0.1', port, timeoutMs: 2_000 });
    assert.equal(verdict.status, 'infected');
    assert.equal(verdict.signature, 'Win.Test.EICAR_HDB-1', 'the signature is what makes a block explicable');
  } finally {
    await close(server);
  }
});

test('a body larger than one chunk still terminates correctly', async () => {
  // Exercises the multi-chunk write path and the backpressure branch: a single
  // Buffer.from(...) body would never hit either.
  const server = fakeClamd('stream: OK');
  const port = await listen(server);
  try {
    const chunks = Array.from({ length: 40 }, () => Buffer.alloc(64 * 1024, 0x41));
    const verdict = await scanStream(Readable.from(chunks), { host: '127.0.0.1', port, timeoutMs: 5_000 });
    assert.deepEqual(verdict, { status: 'clean' });
  } finally {
    await close(server);
  }
});

test('ping reports reachability without scanning anything', async () => {
  const server = fakeClamd('stream: OK');
  const port = await listen(server);
  try {
    assert.equal(await pingClamAv({ host: '127.0.0.1', port, timeoutMs: 2_000 }), true);
  } finally {
    await close(server);
  }
  assert.equal(await pingClamAv({ host: '127.0.0.1', port: 1, timeoutMs: 1_000 }), false);
});

// ── against a real clamd, when one is available ──

test('a real clamd detects EICAR and passes a benign file', { skip: !REAL_CLAMD }, async () => {
  // The EICAR test string: the industry-standard harmless file every scanner is
  // required to flag. Split so this source file does not itself trip a scanner.
  const eicar = 'X5O!P%@AP[4\\PZX54(P^)7CC)7}$'
    + 'EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*';

  const infected = await scanStream(bodyOf(eicar), REAL_CLAMD);
  assert.equal(infected.status, 'infected', 'a real scanner must flag EICAR');
  assert.match(infected.signature, /eicar/i);

  const clean = await scanStream(bodyOf('an ordinary lesson plan'), REAL_CLAMD);
  assert.deepEqual(clean, { status: 'clean' });
});
