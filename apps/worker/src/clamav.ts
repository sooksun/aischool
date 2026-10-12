// ClamAV client — ADR-0009.
//
// Speaks clamd's INSTREAM protocol directly over TCP rather than pulling in a
// dependency: the protocol is a length-prefixed chunk stream terminated by a
// zero-length chunk, and the whole implementation is the 40 lines below. One
// fewer package in the supply chain of a security control is worth more than the
// convenience.
//
// Protocol (clamd docs, INSTREAM):
//   send  "zINSTREAM\0"
//   send  <uint32be length><chunk> ...   for each chunk
//   send  <uint32be 0>                   to end the stream
//   recv  "stream: OK\0"                 clean
//         "stream: <SIG> FOUND\0"        infected
//         "... ERROR\0"                  clamd could not process it
import net from 'node:net';
import type { Readable } from 'node:stream';

export type ScanVerdict =
  | { status: 'clean' }
  | { status: 'infected'; signature: string };

/** Raised whenever a verdict could NOT be established. Callers must treat this
 * as "unknown", never as "clean" — that is the entire point of ADR-0009 §2. */
export class ScanUnavailableError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'ScanUnavailableError';
  }
}

export interface ClamAvOptions {
  host: string;
  port: number;
  /** Whole-scan deadline. clamd can hang on a wedged socket; a scan that never
   * returns would otherwise pin a worker slot forever. */
  timeoutMs: number;
}

/**
 * Stream `body` to clamd and return its verdict.
 *
 * Throws ScanUnavailableError on connect failure, timeout, socket error, or an
 * ERROR reply. It deliberately has no "assume clean" branch: the previous
 * scanner in this codebase produced verdicts it had not earned, and the fix is
 * that the only path returning `{status:'clean'}` is one where clamd said OK.
 */
export async function scanStream(
  body: Readable,
  opts: ClamAvOptions,
): Promise<ScanVerdict> {
  return new Promise<ScanVerdict>((resolve, reject) => {
    const socket = net.createConnection({ host: opts.host, port: opts.port });
    let reply = '';
    let settled = false;

    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      body.destroy();
      fn();
    };

    const timer = setTimeout(() => {
      finish(() => reject(new ScanUnavailableError(`clamd timed out after ${opts.timeoutMs}ms`)));
    }, opts.timeoutMs);

    socket.on('error', (err) => {
      finish(() => reject(new ScanUnavailableError(`clamd socket error: ${err.message}`, { cause: err })));
    });

    socket.on('data', (chunk) => {
      reply += chunk.toString('utf8');
    });

    socket.on('close', () => {
      if (settled) return;
      const text = reply.replace(/\0/g, '').trim();
      if (!text) {
        finish(() => reject(new ScanUnavailableError('clamd closed the connection without replying')));
        return;
      }
      // "stream: OK" | "stream: Eicar-Signature FOUND" | "... ERROR"
      if (/\bOK$/.test(text)) {
        finish(() => resolve({ status: 'clean' }));
      } else if (/\bFOUND$/.test(text)) {
        const signature = text.replace(/^stream:\s*/, '').replace(/\s*FOUND$/, '').trim();
        finish(() => resolve({ status: 'infected', signature: signature || 'unknown' }));
      } else {
        // Includes "INSTREAM size limit exceeded" — clamd refusing to scan is
        // not a clean bill of health.
        finish(() => reject(new ScanUnavailableError(`clamd replied: ${text}`)));
      }
    });

    socket.on('connect', () => {
      socket.write('zINSTREAM\0');

      body.on('data', (chunk: Buffer) => {
        const header = Buffer.alloc(4);
        header.writeUInt32BE(chunk.length, 0);
        // Backpressure: clamd is slower than MinIO on large files, and without
        // this a big video buffers the whole object into memory.
        if (!socket.write(Buffer.concat([header, chunk]))) {
          body.pause();
          socket.once('drain', () => body.resume());
        }
      });

      body.on('end', () => {
        const terminator = Buffer.alloc(4);
        terminator.writeUInt32BE(0, 0);
        socket.write(terminator);
      });

      body.on('error', (err) => {
        finish(() => reject(new ScanUnavailableError(`could not read object for scanning: ${err.message}`, { cause: err })));
      });
    });
  });
}

/** clamd's PING/PONG — used by the worker at boot so a misconfigured scanner is
 * discovered on startup rather than on the first upload. */
export async function pingClamAv(opts: ClamAvOptions): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const socket = net.createConnection({ host: opts.host, port: opts.port });
    let reply = '';
    const done = (ok: boolean) => {
      clearTimeout(timer);
      socket.destroy();
      resolve(ok);
    };
    const timer = setTimeout(() => done(false), opts.timeoutMs);
    socket.on('error', () => done(false));
    socket.on('data', (c) => { reply += c.toString('utf8'); });
    socket.on('close', () => done(reply.includes('PONG')));
    socket.on('connect', () => socket.write('zPING\0'));
  });
}
