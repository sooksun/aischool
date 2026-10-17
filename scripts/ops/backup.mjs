#!/usr/bin/env node
/**
 * backup — PostgreSQL dump + object mirror, retention pruning, and a restore check.
 *
 * Replaces the copy-paste dump/mirror commands that used to be the whole of
 * ops-runbook §5. The 2026-07-19 audit named this the item with the largest
 * unbounded downside: the runbook itself calls evidence irreplaceable and then
 * asked a human to remember to type two commands.
 *
 * Production (ADR-0011/0013) relies on RDS automated backups and S3 versioning +
 * Object Lock; this script is for dev, staging and the Thai-owned profile, and
 * is the drill that proves a logical dump restores.
 *
 * ## The part that makes it a backup rather than a file
 *
 * `--verify` restores the dump into a scratch database and compares table and
 * trigger counts. A dump that has never been restored is a hypothesis. Verification
 * is on by default and has to be switched off explicitly.
 *
 * ## Usage
 *   node scripts/ops/backup.mjs                      # dump + mirror + verify + prune
 *   node scripts/ops/backup.mjs --no-verify          # skip the restore check
 *   node scripts/ops/backup.mjs --no-objects         # database only
 *   node scripts/ops/backup.mjs --retain-days=30
 *
 * ## Environment
 *   DATABASE_URL         the database to dump (seip_migrator: it owns every table)
 *   BACKUP_ADMIN_URL     a role with CREATEDB for the verify scratch database
 *                        (defaults to DATABASE_URL; seip_migrator has no CREATEDB)
 *   BACKUP_DIR           default ./backups
 *   BACKUP_RETAIN_DAYS   default 14
 *   S3_ENDPOINT / S3_BUCKET / S3_ACCESS_KEY / S3_SECRET_KEY / S3_REGION   object mirror
 *   PG_BIN_DIR / AWS_BIN override tool locations
 *
 * Requires `pg_dump`, `pg_restore`, `psql` and (for objects) the `aws` CLI.
 */
import { spawn } from 'node:child_process';
import { mkdir, readdir, stat, rm, chmod } from 'node:fs/promises';
import { join, resolve } from 'node:path';

function flag(name) {
  return process.argv.includes(`--${name}`);
}
function opt(name, fallback) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(`--${name}=`.length) : fallback;
}
function die(msg) {
  console.error(`backup: ${msg}`);
  process.exit(1);
}

/** DATABASE_URL -> connection parts. Parsed rather than asking for the same
 * details twice in different env vars, which is how the two drift apart. */
function parseDatabaseUrl(url) {
  let u;
  try {
    u = new URL(url);
  } catch {
    die('database URL is not a valid URL');
  }
  if (!/^postgres(ql)?:$/.test(u.protocol)) die(`database URL is not postgresql: ${u.protocol}`);
  return {
    host: u.hostname || '127.0.0.1',
    port: u.port || '5432',
    user: decodeURIComponent(u.username || 'postgres'),
    password: decodeURIComponent(u.password || ''),
    database: u.pathname.replace(/^\//, ''),
  };
}

/**
 * Runs a command, returning {code, stderr, out}. The password reaches the pg
 * tools via PGPASSWORD in the environment rather than in argv: argv is
 * world-readable through `ps` on most systems.
 */
function run(cmd, args, { env = {}, collect = false } = {}) {
  return new Promise((resolvePromise) => {
    const child = spawn(cmd, args, {
      env: { ...process.env, ...env },
      stdio: ['ignore', collect ? 'pipe' : 'inherit', 'pipe'],
    });
    let stderr = '';
    let out = '';
    child.stderr.on('data', (d) => { stderr += d.toString(); });
    if (collect) child.stdout.on('data', (d) => { out += d.toString(); });
    child.on('error', (err) => resolvePromise({ code: -1, stderr: err.message, out }));
    child.on('close', (code) => resolvePromise({ code, stderr, out }));
  });
}

const pgBin = (name) => (process.env.PG_BIN_DIR ? join(process.env.PG_BIN_DIR, name) : name);
const connArgs = (c) => ['-h', c.host, '-p', c.port, '-U', c.user];
const pgEnv = (c) => ({ PGPASSWORD: c.password });

const db = parseDatabaseUrl(process.env.DATABASE_URL ?? die('DATABASE_URL is required'));
const admin = parseDatabaseUrl(process.env.BACKUP_ADMIN_URL ?? process.env.DATABASE_URL);
const backupDir = resolve(opt('dir', process.env.BACKUP_DIR ?? './backups'));
const retainDays = Number(opt('retain-days', process.env.BACKUP_RETAIN_DAYS ?? '14'));
const awsBin = process.env.AWS_BIN ?? 'aws';

// Local time, not UTC: an operator reading a filename is reasoning in the
// school's timezone, and a name they misread by 7 hours is worse than useless
// when they are choosing which snapshot to restore.
const stamp = new Date().toLocaleString('sv-SE').replace(/[: ]/g, '-');
const dumpPath = join(backupDir, `seip-${stamp}.dump`);
const objectDir = join(backupDir, `objects-${stamp}`);

await mkdir(backupDir, { recursive: true });
// Backups contain every teacher's evidence metadata and every evaluation score —
// PDPA data at rest. 0700 so it is not world-readable by default on the host.
await chmod(backupDir, 0o700).catch(() => { /* best effort; Windows has no mode */ });

// ── 1. database ──────────────────────────────────────────────────────────────

console.log(`[backup] dumping ${db.database} -> ${dumpPath}`);
{
  // Custom format (-Fc): compressed, and pg_restore can verify its table of
  // contents before anything is written. --no-owner/--no-acl so the dump restores
  // under whichever role runs the drill; production grants come from
  // scripts/db/bootstrap-roles.sql + the migrations, not from the dump.
  const { code, stderr } = await run(
    pgBin('pg_dump'),
    [...connArgs(db), '-Fc', '--no-owner', '--no-acl', '-f', dumpPath, db.database],
    { env: pgEnv(db) },
  );
  if (code !== 0) {
    await rm(dumpPath, { force: true });
    die(`pg_dump failed (${code}): ${stderr.trim()}`);
  }
}
const dumpBytes = (await stat(dumpPath)).size;
console.log(`[backup] dump written, ${(dumpBytes / 1024 / 1024).toFixed(2)} MB`);

// ── 2. verify ────────────────────────────────────────────────────────────────

const countSql = `SELECT
  (SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE')
  || ' ' ||
  (SELECT COUNT(DISTINCT trigger_name) FROM information_schema.triggers WHERE trigger_schema = 'public')`;

async function counts(c, database) {
  const r = await run(pgBin('psql'), [...connArgs(c), '-At', '-d', database, '-c', countSql],
    { env: pgEnv(c), collect: true });
  if (r.code !== 0) throw new Error(`count query failed on ${database}: ${r.stderr.trim()}`);
  const [tables, triggers] = r.out.trim().split(' ').map(Number);
  return { tables, triggers };
}

if (!flag('no-verify')) {
  const scratch = `${db.database}_verify_${Date.now()}`;
  console.log(`[backup] verifying: restore into scratch database ${scratch}`);
  const fail = (msg) => { throw new Error(msg); };
  const created = await run(pgBin('createdb'), [...connArgs(admin), scratch], { env: pgEnv(admin) });
  if (created.code !== 0) die(`could not create scratch database (needs CREATEDB — set BACKUP_ADMIN_URL): ${created.stderr.trim()}`);
  try {
    const restore = await run(pgBin('pg_restore'),
      [...connArgs(admin), '--no-owner', '--no-acl', '--exit-on-error', '-d', scratch, dumpPath],
      { env: pgEnv(admin) });
    if (restore.code !== 0) fail(`RESTORE FAILED — this dump is not usable: ${restore.stderr.trim()}`);

    // Restoring without error is necessary but not sufficient: an empty dump
    // restores perfectly. Compare against the live database.
    const live = await counts(db, db.database);
    const restored = await counts(admin, scratch);
    if (!restored.tables) fail('verify restored 0 tables — the dump is empty or unreadable');
    if (live.tables !== restored.tables) {
      fail(`verify mismatch: live has ${live.tables} tables, the restore produced ${restored.tables}`);
    }
    // The audit-immutability triggers are part of the security model (ADR-0012).
    if (live.triggers !== restored.triggers) {
      fail(`verify mismatch: live has ${live.triggers} triggers, the restore produced ${restored.triggers}`);
    }
    console.log(`[backup] verified: ${restored.tables} tables, ${restored.triggers} triggers restored cleanly`);
  } catch (err) {
    // Drop first, then report: an orphaned verify database is a second problem
    // for whoever investigates the first one.
    await run(pgBin('dropdb'), [...connArgs(admin), '--if-exists', scratch], { env: pgEnv(admin) });
    die(err.message);
  }
  await run(pgBin('dropdb'), [...connArgs(admin), '--if-exists', scratch], { env: pgEnv(admin) });
} else {
  console.log('[backup] WARNING: --no-verify — this dump has not been proven restorable');
}

// ── 3. objects ───────────────────────────────────────────────────────────────

if (!flag('no-objects')) {
  const endpoint = process.env.S3_ENDPOINT;
  const bucket = process.env.S3_BUCKET;
  if (!bucket) die('S3_BUCKET is required for the object mirror (or pass --no-objects)');
  console.log(`[backup] mirroring ${bucket} -> ${objectDir}`);
  await mkdir(objectDir, { recursive: true });

  // NOT --delete: a mirror that deletes local copies of objects missing upstream
  // would faithfully replicate an accidental bucket wipe into the backup.
  const sync = await run(awsBin, [
    's3', 'sync', `s3://${bucket}`, objectDir,
    ...(endpoint ? ['--endpoint-url', endpoint] : []),
  ], {
    env: {
      AWS_ACCESS_KEY_ID: process.env.S3_ACCESS_KEY ?? '',
      AWS_SECRET_ACCESS_KEY: process.env.S3_SECRET_KEY ?? '',
      AWS_DEFAULT_REGION: process.env.S3_REGION ?? 'ap-southeast-7',
    },
  });
  if (sync.code !== 0) die(`aws s3 sync failed — is the aws CLI installed? ${sync.stderr.trim()}`);
  console.log('[backup] objects mirrored');
}

// ── 4. retention ─────────────────────────────────────────────────────────────

if (retainDays > 0) {
  const cutoff = Date.now() - retainDays * 24 * 60 * 60 * 1000;
  const entries = await readdir(backupDir);
  let pruned = 0;
  for (const name of entries) {
    if (!/^seip-.*\.dump$|^objects-/.test(name)) continue;
    const path = join(backupDir, name);
    const info = await stat(path);
    if (info.mtimeMs < cutoff) {
      await rm(path, { recursive: true, force: true });
      pruned++;
    }
  }
  console.log(`[backup] retention ${retainDays}d — pruned ${pruned} old artefact(s)`);
}

console.log(`\n[backup] OK  ${dumpPath}`);
console.log('[backup] Restore with: node scripts/ops/restore.mjs --from=<file>\n');
