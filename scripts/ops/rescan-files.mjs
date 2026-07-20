#!/usr/bin/env node
/**
 * rescan-files — re-scan evidence uploaded before a real scanner existed.
 *
 * ADR-0009 wired ClamAV into the upload path but named its own blind spot under
 * Consequences: "Not addressed here: re-scanning existing files... Any deployment
 * predating CCR-012 should re-scan its whole store once this is enabled." This is
 * that sweep.
 *
 * ## What is actually wrong without it
 *
 * It is not only that old files are unscanned. Before CCR-012, `file.process`
 * matched "eicar"/"virus" against the FILENAME, read no bytes, and wrote `clean`
 * for everything else. Those rows are still there, still `clean`, still
 * downloadable, still wearing the "ปลอดภัย" badge. This database has 81 of them
 * and has never had a real scanner behind it.
 *
 * So the sweep cannot select on `scan_status` — `clean` is exactly the state that
 * lies. It selects on `scanned_at IS NULL`, the receipt written only when clamd
 * genuinely returned a verdict. Migration 20260718220000 declined to backfill
 * those rows because it "cannot distinguish those rows from ones a real scanner
 * might have cleared"; `scanned_at` is that distinction, made durable.
 *
 * ## What this script does NOT do
 *
 * It does not scan, and it never writes a verdict. It enqueues `file.process`
 * jobs and stops. The worker performs the scan through the same code path an
 * upload takes, so there is exactly one implementation of "what is this file" and
 * one fail-closed policy governing it. A second scanner here would be a second
 * thing to keep honest, and the first one to drift.
 *
 * ## Usage
 *   npm run rescan:files -- --report          # census only, changes nothing
 *   npm run rescan:files -- --dry-run         # what would be queued
 *   npm run rescan:files                      # queue up to --limit (default 500)
 *   npm run rescan:files -- --limit=5000 --school=<id>
 *   npm run rescan:files -- --include-blocked
 *   npm run rescan:files -- --scanned-before=2026-07-01   # after a signature update
 */
import {
  prisma,
  listFilesForRescan,
  countFilesForRescan,
  scanCoverageCensus,
  listQueuedFileProcessTargets,
  enqueueWorkerJob,
  summariseRescanJobs,
} from '@seip/database';

function arg(name) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(`--${name}=`.length) : undefined;
}
const flag = (name) => process.argv.includes(`--${name}`);

function die(msg) {
  console.error(`rescan-files: ${msg}`);
  process.exit(1);
}

const report = flag('report');
const dryRun = flag('dry-run');
const includeBlocked = flag('include-blocked');
const schoolId = arg('school');
const limit = Number(arg('limit') ?? 500);
const scannedBeforeRaw = arg('scanned-before');

if (!Number.isInteger(limit) || limit <= 0) die('--limit must be a positive integer');

let scannedBefore = null;
if (scannedBeforeRaw) {
  scannedBefore = new Date(scannedBeforeRaw);
  if (Number.isNaN(scannedBefore.getTime())) die(`--scanned-before is not a date: ${scannedBeforeRaw}`);
}

/**
 * `blocked` is opt-in, and it is the one status where re-scanning can *widen*
 * access: a file blocked only because it exceeded CLAMAV_MAX_BYTES becomes
 * downloadable if clamd now clears it. That is a legitimate reason to run this —
 * after raising StreamMaxLength — but it should be something an operator asked
 * for by name, not a side effect of a routine sweep.
 *
 * `clean` is in the default set precisely because it is the untrustworthy one.
 */
const statuses = includeBlocked
  ? ['pending', 'clean', 'unscanned', 'blocked']
  : ['pending', 'clean', 'unscanned'];

async function printCensus() {
  const { rows, softDeleted } = await scanCoverageCensus(schoolId);
  if (rows.length === 0) {
    console.log('\n  no live evidence files\n');
    return;
  }
  console.log('\n  scan coverage' + (schoolId ? ` (school ${schoolId})` : '') + ', live evidence:\n');
  console.log('    status      files   with a real verdict');
  console.log('    ─────────────────────────────────────────');
  let unverified = 0;
  for (const r of rows.sort((a, b) => a.scanStatus.localeCompare(b.scanStatus))) {
    const gap = r.total - r.verified;
    unverified += gap;
    console.log(
      `    ${r.scanStatus.padEnd(10)} ${String(r.total).padStart(6)}   ${String(r.verified).padStart(8)}`
      + (gap > 0 ? `   ← ${gap} never scanned` : ''),
    );
  }
  console.log(`\n  ${unverified} live file(s) carry no scan receipt.`);
  // The single most useful line here: a `clean` row without a receipt is the
  // platform asserting safety it never established — and unlike `unscanned` or
  // `blocked`, that file is being served right now.
  const cleanRow = rows.find((r) => r.scanStatus === 'clean');
  if (cleanRow && cleanRow.total > cleanRow.verified) {
    console.log(
      `  WARNING: ${cleanRow.total - cleanRow.verified} of them read "clean" — downloadable, `
      + 'badged ปลอดภัย, never verified (pre-CCR-012 filename stub).',
    );
  }
  if (softDeleted > 0) {
    console.log(
      `  (${softDeleted} soft-deleted file(s) are also unverified — excluded above because nothing `
      + 'serves them, but they are restorable, so a restore should be followed by a sweep.)',
    );
  }

  // Without this, a sweep that cannot finish looks identical to one still
  // running: the census simply stops moving. Jobs that exhausted their retries
  // are the usual reason, and the operator needs the error text to act on them.
  const jobs = await summariseRescanJobs();
  if (jobs.queued > 0 || jobs.failed > 0) {
    console.log(`\n  re-scan queue: ${jobs.queued} waiting, ${jobs.failed} gave up after 8 attempts.`);
    for (const [message, n] of jobs.errors.slice(0, 8)) {
      console.log(`    ${String(n).padStart(4)}×  ${message.slice(0, 110)}`);
    }
    if (jobs.errors.length > 8) console.log(`    … and ${jobs.errors.length - 8} other error(s)`);
    if (jobs.failed > 0) {
      console.log(
        '    a failed job leaves its file exactly as it was — no verdict was invented for it.',
      );
      // Worth saying out loud: the skip-guard only looks at pending/running jobs,
      // so terminally-failed ones do NOT stop the file being selected again. That
      // is right for a transient outage and wrong for a permanently absent
      // object, which will burn 8 attempts on every future sweep until the row
      // or the object is dealt with.
      console.log(
        '    NOTE: these files are still selected by the next sweep and will fail again. '
        + 'Restore the objects or remove the rows — the scanner cannot fix a file that is not there.',
      );
    }
  }
  console.log();
}

try {
  if (report) {
    await printCensus();
    process.exit(0);
  }

  // Refuse to sweep without a scanner. Otherwise every job would re-derive
  // `unscanned`, write no receipt, and re-emit scan_completed — the whole store
  // churned through the queue to change nothing, and the census afterwards would
  // look exactly as it did before. Better to say why than to appear to work.
  if (process.env.SCAN_PROVIDER !== 'clamav' && !dryRun) {
    die(
      'SCAN_PROVIDER is not "clamav", so re-scanning would only rewrite `unscanned` '
      + 'and change nothing. Enable the scanner first (ADR-0009), or use --dry-run.',
    );
  }

  const selection = { statuses, scannedBefore, schoolId, limit };
  const total = await countFilesForRescan({ statuses, scannedBefore, schoolId });
  if (total === 0) {
    console.log('\n  nothing to re-scan — every matching file already has a scan receipt.\n');
    process.exit(0);
  }

  const candidates = await listFilesForRescan(selection);
  const queued = await listQueuedFileProcessTargets();
  const fresh = candidates.filter((f) => !queued.has(f.id));
  const skipped = candidates.length - fresh.length;

  console.log(`\n  ${total} file(s) need re-scanning${schoolId ? ` in school ${schoolId}` : ''}.`);
  console.log(`  selecting ${candidates.length} (--limit=${limit}), oldest upload first.`);
  if (skipped > 0) console.log(`  ${skipped} already queued from an earlier run — skipping.`);

  const byStatus = new Map();
  for (const f of fresh) byStatus.set(f.scanStatus, (byStatus.get(f.scanStatus) ?? 0) + 1);
  for (const [status, n] of [...byStatus].sort()) console.log(`    ${status.padEnd(10)} ${n}`);

  if (dryRun) {
    console.log('\n  --dry-run: nothing queued.\n');
    process.exit(0);
  }
  if (fresh.length === 0) {
    console.log('\n  all selected files are already queued; nothing to do.\n');
    process.exit(0);
  }

  // One job per file, not one bulk job: the worker's retry, backoff and terminal
  // -failure accounting are all per-job, so a single unreadable object costs that
  // file its 8 attempts instead of aborting the batch around it.
  let enqueued = 0;
  for (const file of fresh) {
    await enqueueWorkerJob({
      jobType: 'file.process',
      payload: {
        file_id: file.id,
        evidence_id: file.evidenceId,
        school_id: file.evidence.schoolId,
        reason: 'rescan',
      },
    });
    enqueued += 1;
  }

  const remaining = total - enqueued - skipped;
  console.log(`\n  queued ${enqueued} file.process job(s).`);
  if (remaining > 0) {
    console.log(`  ${remaining} still unswept — re-run to continue (safe: queued files are skipped).`);
  }
  console.log('  the worker must be running; watch progress with --report.');
  console.log(
    '  expect some files to end `blocked`: that is the sweep working, not failing.\n',
  );
} finally {
  await prisma.$disconnect();
}
