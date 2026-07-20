#!/usr/bin/env node
/**
 * restore — put a backup back.
 *
 * Exists because a backup procedure with no restore procedure is half a
 * procedure, and the half nobody rehearses is the one that fails. The release
 * gate in docs/qa/QUALITY-GATES.md calls for a backup/restore test; this is the
 * command that test runs.
 *
 * ## Usage
 *   node scripts/ops/restore.mjs --from=backups/seip-2026-07-20-05-00-00.sql.gz --dry-run
 *   node scripts/ops/restore.mjs --from=<file> --into=seip_restore_check
 *   node scripts/ops/restore.mjs --from=<file> --into=seip --i-understand-this-overwrites
 *
 * `--dry-run` (restore into a scratch database, report, drop it) is the default
 * shape of a drill. Restoring over a live database requires naming it AND the
 * long flag: an operator who has to type `--i-understand-this-overwrites` at 2am
 * has been given one more chance to notice which database they are pointed at.
 */
import { spawn } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createGunzip } from 'node:zlib';

function opt(name, fallback) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(`--${name}=`.length) : fallback;
}
function flag(name) {
  return process.argv.includes(`--${name}`);
}
function die(msg) {
  console.error(`restore: ${msg}`);
  process.exit(1);
}

function parseDatabaseUrl(url) {
  const u = new URL(url);
  return {
    host: u.hostname || '127.0.0.1',
    port: u.port || '3306',
    user: decodeURIComponent(u.username || 'root'),
    password: decodeURIComponent(u.password || ''),
    database: u.pathname.replace(/^\//, ''),
  };
}

function run(cmd, args, { env = {}, collect = false, stdin } = {}) {
  return new Promise((resolvePromise) => {
    const child = spawn(cmd, args, {
      env: { ...process.env, ...env },
      stdio: [stdin ? 'pipe' : 'ignore', collect ? 'pipe' : 'inherit', 'pipe'],
    });
    let out = '';
    let stderr = '';
    if (collect && child.stdout) child.stdout.on('data', (d) => { out += d.toString(); });
    child.stderr.on('data', (d) => { stderr += d.toString(); });
    if (stdin && child.stdin) {
      // Swallow EPIPE so the real reason (in stderr) survives to be printed.
      child.stdin.on('error', () => {});
      stdin.on('error', (err) => { stderr += `
[stdin] ${err.message}`; });
      stdin.pipe(child.stdin);
    }
    child.on('error', (e) => resolvePromise({ code: -1, stderr: e.message, out }));
    child.on('close', (code) => resolvePromise({ code, stderr, out }));
  });
}

const from = opt('from') ?? die('--from=<backup.sql.gz> is required');
await stat(from).catch(() => die(`no such backup file: ${from}`));

const db = parseDatabaseUrl(process.env.DATABASE_URL ?? die('DATABASE_URL is required'));
const mysqlBin = process.env.MYSQL_BIN ?? 'mysql';
const dryRun = flag('dry-run') || !opt('into');
const target = dryRun ? `${db.database}_restore_check_${Date.now()}` : opt('into');

if (!dryRun && target === db.database && !flag('i-understand-this-overwrites')) {
  die(
    `refusing to restore over the live database '${target}'.\n`
    + '       Re-run with --i-understand-this-overwrites if that is genuinely what you want,\n'
    + '       or drop --into to do a safe drill into a scratch database instead.',
  );
}

const args = [`--host=${db.host}`, `--port=${db.port}`, `--user=${db.user}`];
const env = { env: { MYSQL_PWD: db.password } };

console.log(`[restore] ${from} -> ${target}${dryRun ? ' (drill — will be dropped)' : ''}`);

const created = await run(mysqlBin, [...args, '-e', `CREATE DATABASE IF NOT EXISTS \`${target}\``], env);
if (created.code !== 0) die(`could not create ${target}: ${created.stderr.trim()}`);

try {
  // Gunzip in-process and write to mysql's stdin. A `gzip -dc | mysql` shell pipe
  // was the first version; it has no `gzip` on Windows and quotes differently in
  // cmd, so the drill failed on the machine most likely to be running it.
  const source = createReadStream(from).pipe(createGunzip());
  const restored = await run(mysqlBin, [...args, target], { ...env, stdin: source });
  if (restored.code !== 0) die(`restore failed: ${restored.stderr.trim()}`);

  // Report what actually landed. "It restored without error" is not the same as
  // "the data is there" — an empty dump restores perfectly.
  const counts = await run(mysqlBin, [
    ...args, '-N', '-B', '-e',
    `SELECT
       (SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='${target}'),
       (SELECT COUNT(*) FROM information_schema.triggers WHERE trigger_schema='${target}'),
       (SELECT COUNT(*) FROM \`${target}\`.evidence),
       (SELECT COUNT(*) FROM \`${target}\`.user_account)`,
  ], { ...env, collect: true });

  if (counts.code === 0) {
    const [tables, triggers, evidence, users] = counts.out.trim().split(/\s+/);
    console.log(`[restore] tables=${tables} triggers=${triggers} evidence=${evidence} users=${users}`);
    // The audit-immutability triggers are part of the security model (ADR-0008).
    // A restore that silently lost them yields a database that accepts audit
    // deletions — which is exactly the thing an audit log exists to prevent.
    if (Number(triggers) === 0) {
      die('restored database has NO triggers — audit immutability would be gone. Dump was taken without --triggers.');
    }
  } else {
    console.warn(`[restore] could not read counts: ${counts.stderr.trim()}`);
  }

  console.log(`\n[restore] OK  ${dryRun ? 'drill passed' : `restored into ${target}`}\n`);
} finally {
  if (dryRun) {
    await run(mysqlBin, [...args, '-e', `DROP DATABASE IF EXISTS \`${target}\``], env);
    console.log('[restore] drill database dropped');
  }
}
