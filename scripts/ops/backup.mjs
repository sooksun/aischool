#!/usr/bin/env node
/**
 * backup — MySQL dump + MinIO mirror, retention pruning, and a restore check.
 *
 * Replaces the copy-paste `mysqldump` / `mc mirror` commands that used to be the
 * whole of ops-runbook §5. The 2026-07-19 audit named this the item with the
 * largest unbounded downside: the runbook itself calls evidence irreplaceable and
 * then asked a human to remember to type two commands.
 *
 * ## The part that makes it a backup rather than a file
 *
 * `--verify` restores the dump into a scratch database and counts rows. A dump
 * that has never been restored is a hypothesis. mysqldump exits 0 on plenty of
 * dumps that will not restore — a mid-stream disconnect leaves a truncated file
 * that looks fine until the day it matters. Verification is on by default and
 * has to be switched off explicitly.
 *
 * ## Usage
 *   node scripts/ops/backup.mjs                      # dump + mirror + verify + prune
 *   node scripts/ops/backup.mjs --no-verify          # skip the restore check
 *   node scripts/ops/backup.mjs --no-objects         # database only
 *   node scripts/ops/backup.mjs --retain-days=30
 *
 * ## Environment
 *   DATABASE_URL         parsed for host/port/user/password/database
 *   BACKUP_DIR           default ./backups
 *   BACKUP_RETAIN_DAYS   default 14
 *   S3_ENDPOINT / S3_BUCKET / S3_ACCESS_KEY / S3_SECRET_KEY   for the object mirror
 *   MYSQL_BIN / MC_BIN   override tool paths
 *
 * Requires `mysqldump`, `mysql` and (for objects) `mc` on PATH.
 */
import { spawn } from 'node:child_process';
import { createWriteStream, createReadStream } from 'node:fs';
import { mkdir, readdir, stat, rm, chmod } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { createGzip, createGunzip } from 'node:zlib';

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
    die('DATABASE_URL is not a valid URL');
  }
  if (!u.protocol.startsWith('mysql')) die(`DATABASE_URL is not mysql: ${u.protocol}`);
  return {
    host: u.hostname || '127.0.0.1',
    port: u.port || '3306',
    user: decodeURIComponent(u.username || 'root'),
    password: decodeURIComponent(u.password || ''),
    database: u.pathname.replace(/^\//, ''),
  };
}

/**
 * Runs a command, returning {code, stderr}. The password reaches mysqldump via
 * MYSQL_PWD in the environment rather than -p on the command line: argv is
 * world-readable through `ps` on most systems, so a -p flag leaks the database
 * password to every local user for the duration of the dump.
 */
function run(cmd, args, { env = {}, stdout, stdin } = {}) {
  return new Promise((resolvePromise) => {
    const child = spawn(cmd, args, {
      env: { ...process.env, ...env },
      stdio: [stdin ? 'pipe' : 'ignore', stdout ? 'pipe' : 'inherit', 'pipe'],
    });
    let stderr = '';
    child.stderr.on('data', (d) => { stderr += d.toString(); });
    if (stdout && child.stdout) stdout(child.stdout);
    if (stdin && child.stdin) {
      // If mysql exits early (bad credentials, a statement it rejects), the pipe
      // to its stdin breaks with EPIPE. Unhandled, that error kills this process
      // and the ACTUAL reason — sitting in stderr — is never printed. Swallow the
      // pipe error and let the close handler report why it really exited.
      child.stdin.on('error', () => { /* reported via stderr + exit code below */ });
      stdin.on('error', (err) => { stderr += `\n[stdin] ${err.message}`; });
      stdin.pipe(child.stdin);
    }
    child.on('error', (err) => resolvePromise({ code: -1, stderr: err.message }));
    child.on('close', (code) => resolvePromise({ code, stderr }));
  });
}

/**
 * Feed a .sql.gz into `mysql` by decompressing in-process and writing to its
 * stdin.
 *
 * The obvious version — `sh -c "gzip -dc file | mysql ..."` — was the first
 * attempt and it broke immediately on Windows: the cmd branch has no `gzip`, and
 * the quoting differs from sh. Doing the gunzip in Node removes both the shell
 * and the external gzip dependency, so this works identically on the Laragon dev
 * box and in a Linux container.
 */
function restoreDump(mysqlBin, connArgs, targetDb, dumpPath, env) {
  const source = createReadStream(dumpPath).pipe(createGunzip());
  return run(mysqlBin, [...connArgs, targetDb], { env, stdin: source });
}

const db = parseDatabaseUrl(process.env.DATABASE_URL ?? die('DATABASE_URL is required'));
const backupDir = resolve(opt('dir', process.env.BACKUP_DIR ?? './backups'));
const retainDays = Number(opt('retain-days', process.env.BACKUP_RETAIN_DAYS ?? '14'));
const mysqlBin = process.env.MYSQL_BIN ?? 'mysql';
const mysqldumpBin = process.env.MYSQLDUMP_BIN ?? 'mysqldump';
const mcBin = process.env.MC_BIN ?? 'mc';

// Local time, not UTC: an operator reading a filename is reasoning in the
// school's timezone, and a name they misread by 7 hours is worse than useless
// when they are choosing which snapshot to restore.
const stamp = new Date().toLocaleString('sv-SE').replace(/[: ]/g, '-');
const sqlPath = join(backupDir, `seip-${stamp}.sql.gz`);
const objectDir = join(backupDir, `objects-${stamp}`);

await mkdir(backupDir, { recursive: true });
// Backups contain every teacher's evidence metadata and every evaluation score —
// PDPA data at rest. 0700 so it is not world-readable by default on the host.
await chmod(backupDir, 0o700).catch(() => { /* best effort; Windows has no mode */ });

// ── 1. database ──────────────────────────────────────────────────────────────

console.log(`[backup] dumping ${db.database} -> ${sqlPath}`);
{
  // --result-file, NOT stdout piped into gzip.
  //
  // On Windows mysqldump.exe writes stdout in text mode and converts every \n to
  // \r\n. That turns `DELIMITER ;;` into `DELIMITER ;;\r`, the client never
  // matches the delimiter again, and every trigger in the dump fails to restore
  // with a syntax error near `*/`. MySQL documents --result-file as the fix for
  // exactly this. The first version of this script piped stdout and produced
  // dumps that looked perfect and could not be restored — which is precisely what
  // the verify step below exists to catch, and did.
  const rawPath = `${sqlPath}.tmp.sql`;
  const { code, stderr } = await run(
    mysqldumpBin,
    [
      `--host=${db.host}`, `--port=${db.port}`, `--user=${db.user}`,
      // --single-transaction: consistent snapshot without locking writers out.
      // --routines/--triggers: the audit-immutability triggers and the generated
      // -column machinery are part of the schema (ADR-0008); a dump without them
      // restores a database that silently accepts audit deletions.
      '--single-transaction', '--routines', '--triggers', '--events',
      '--default-character-set=utf8mb4',
      `--result-file=${rawPath}`,
      db.database,
    ],
    { env: { MYSQL_PWD: db.password } },
  );
  if (code !== 0) {
    await rm(rawPath, { force: true });
    die(`mysqldump failed (${code}): ${stderr.trim()}`);
  }

  await pipeline(
    createReadStream(rawPath),
    createGzip(),
    createWriteStream(sqlPath, { mode: 0o600 }),
  );
  await rm(rawPath, { force: true });
}
const dumpBytes = (await stat(sqlPath)).size;
console.log(`[backup] dump written, ${(dumpBytes / 1024 / 1024).toFixed(2)} MB`);

// ── 2. verify by actually restoring it ───────────────────────────────────────

if (!flag('no-verify')) {
  const scratch = `${db.database}_verify_${Date.now()}`;
  console.log(`[backup] verifying by restoring into ${scratch}`);
  const mysqlArgs = [`--host=${db.host}`, `--port=${db.port}`, `--user=${db.user}`];
  const mysqlEnv = { env: { MYSQL_PWD: db.password } };

  const created = await run(mysqlBin, [...mysqlArgs, '-e', `CREATE DATABASE \`${scratch}\``], mysqlEnv);
  if (created.code !== 0) die(`could not create verify database: ${created.stderr.trim()}`);

  // `fail()` rather than `die()` inside this block: die() calls process.exit,
  // which skips the finally below and leaves an orphaned scratch database behind
  // on every failed verify. Found exactly that way on the first real run.
  const fail = (msg) => { throw new Error(msg); };
  try {
    const restore = await restoreDump(mysqlBin, mysqlArgs, scratch, sqlPath, mysqlEnv.env);
    if (restore.code !== 0) fail(`RESTORE FAILED — this dump is not usable: ${restore.stderr.trim()}`);

    // Restoring without error is necessary but not sufficient: an empty dump
    // restores perfectly. Compare table counts against the live database.
    let liveOut = '';
    let restoredOut = '';
    const countSql = "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = ";
    await run(mysqlBin, [...mysqlArgs, '-N', '-B', '-e', `${countSql}'${db.database}'`],
      { ...mysqlEnv, stdout: (s) => s.on('data', (d) => { liveOut += d.toString(); }) });
    await run(mysqlBin, [...mysqlArgs, '-N', '-B', '-e', `${countSql}'${scratch}'`],
      { ...mysqlEnv, stdout: (s) => s.on('data', (d) => { restoredOut += d.toString(); }) });

    const liveTables = Number(liveOut.trim());
    const restoredTables = Number(restoredOut.trim());
    if (!Number.isFinite(restoredTables) || restoredTables === 0) {
      fail('verify restored 0 tables — the dump is empty or unreadable');
    }
    if (liveTables !== restoredTables) {
      fail(`verify mismatch: live has ${liveTables} tables, the restore produced ${restoredTables}`);
    }
    console.log(`[backup] verified: ${restoredTables} tables restored cleanly`);
  } catch (err) {
    // Drop first, then report: an orphaned verify database is a second problem
    // for whoever investigates the first one.
    await run(mysqlBin, [...mysqlArgs, '-e', `DROP DATABASE IF EXISTS \`${scratch}\``], mysqlEnv);
    die(err.message);
  }
  await run(mysqlBin, [...mysqlArgs, '-e', `DROP DATABASE IF EXISTS \`${scratch}\``], mysqlEnv);
} else {
  console.log('[backup] WARNING: --no-verify — this dump has not been proven restorable');
}

// ── 3. objects ───────────────────────────────────────────────────────────────

if (!flag('no-objects')) {
  const endpoint = process.env.S3_ENDPOINT;
  const bucket = process.env.S3_BUCKET;
  if (!endpoint || !bucket) {
    die('S3_ENDPOINT and S3_BUCKET are required for the object mirror (or pass --no-objects)');
  }
  console.log(`[backup] mirroring ${bucket} -> ${objectDir}`);
  await mkdir(objectDir, { recursive: true });

  const alias = await run(mcBin, [
    'alias', 'set', 'seip-backup', endpoint,
    process.env.S3_ACCESS_KEY ?? '', process.env.S3_SECRET_KEY ?? '',
  ]);
  if (alias.code !== 0) die(`mc alias failed — is mc installed? ${alias.stderr.trim()}`);

  // NOT --remove: a mirror that deletes local copies of objects missing upstream
  // would faithfully replicate an accidental bucket wipe into the backup.
  const mirror = await run(mcBin, ['mirror', '--overwrite', `seip-backup/${bucket}`, objectDir]);
  if (mirror.code !== 0) die(`mc mirror failed: ${mirror.stderr.trim()}`);
  console.log('[backup] objects mirrored');
}

// ── 4. retention ─────────────────────────────────────────────────────────────

if (retainDays > 0) {
  const cutoff = Date.now() - retainDays * 24 * 60 * 60 * 1000;
  const entries = await readdir(backupDir);
  let pruned = 0;
  for (const name of entries) {
    if (!/^seip-.*\.sql\.gz$|^objects-/.test(name)) continue;
    const path = join(backupDir, name);
    const info = await stat(path);
    if (info.mtimeMs < cutoff) {
      await rm(path, { recursive: true, force: true });
      pruned++;
    }
  }
  console.log(`[backup] retention ${retainDays}d — pruned ${pruned} old artefact(s)`);
}

console.log(`\n[backup] OK  ${sqlPath}`);
console.log('[backup] Restore with: node scripts/ops/restore.mjs --from=<file>\n');
