#!/usr/bin/env node
/**
 * restore — put a backup back (PostgreSQL, ADR-0012).
 *
 * Exists because a backup procedure with no restore procedure is half a
 * procedure, and the half nobody rehearses is the one that fails. The release
 * gate in docs/qa/QUALITY-GATES.md calls for a backup/restore test; this is the
 * command that test runs.
 *
 * ## Usage
 *   node scripts/ops/restore.mjs --from=backups/seip-2026-10-13-05-00-00.dump --dry-run
 *   node scripts/ops/restore.mjs --from=<file> --into=seip_restore_check
 *   node scripts/ops/restore.mjs --from=<file> --into=seip --i-understand-this-overwrites
 *
 * `--dry-run` (restore into a scratch database, report, drop it) is the default
 * shape of a drill. Restoring over a live database requires naming it AND the
 * long flag: an operator who has to type `--i-understand-this-overwrites` at 2am
 * has been given one more chance to notice which database they are pointed at.
 *
 * Connects with BACKUP_ADMIN_URL (a role with CREATEDB), falling back to
 * DATABASE_URL. After a real restore, re-run scripts/db/bootstrap-roles.sql and
 * `prisma migrate deploy` so grants and the audit REVOKE are re-applied — the
 * dump is taken --no-acl on purpose.
 */
import { spawn } from 'node:child_process';
import { stat } from 'node:fs/promises';
import { join } from 'node:path';

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
  if (!/^postgres(ql)?:$/.test(u.protocol)) die(`database URL is not postgresql: ${u.protocol}`);
  return {
    host: u.hostname || '127.0.0.1',
    port: u.port || '5432',
    user: decodeURIComponent(u.username || 'postgres'),
    password: decodeURIComponent(u.password || ''),
    database: u.pathname.replace(/^\//, ''),
  };
}

function run(cmd, args, { env = {}, collect = false } = {}) {
  return new Promise((resolvePromise) => {
    const child = spawn(cmd, args, {
      env: { ...process.env, ...env },
      stdio: ['ignore', collect ? 'pipe' : 'inherit', 'pipe'],
    });
    let out = '';
    let stderr = '';
    if (collect) child.stdout.on('data', (d) => { out += d.toString(); });
    child.stderr.on('data', (d) => { stderr += d.toString(); });
    child.on('error', (e) => resolvePromise({ code: -1, stderr: e.message, out }));
    child.on('close', (code) => resolvePromise({ code, stderr, out }));
  });
}

const from = opt('from') ?? die('--from=<backup.dump> is required');
await stat(from).catch(() => die(`no such backup file: ${from}`));

const live = parseDatabaseUrl(process.env.DATABASE_URL ?? die('DATABASE_URL is required'));
const c = parseDatabaseUrl(process.env.BACKUP_ADMIN_URL ?? process.env.DATABASE_URL);
const pgBin = (name) => (process.env.PG_BIN_DIR ? join(process.env.PG_BIN_DIR, name) : name);
const args = ['-h', c.host, '-p', c.port, '-U', c.user];
const env = { env: { PGPASSWORD: c.password } };

const dryRun = flag('dry-run') || !opt('into');
const target = dryRun ? `${live.database}_restore_check_${Date.now()}` : opt('into');

if (!dryRun && target === live.database && !flag('i-understand-this-overwrites')) {
  die(
    `refusing to restore over the live database '${target}'.\n`
    + '       Re-run with --i-understand-this-overwrites if that is genuinely what you want,\n'
    + '       or drop --into to do a safe drill into a scratch database instead.',
  );
}

console.log(`[restore] ${from} -> ${target}${dryRun ? ' (drill — will be dropped)' : ''}`);

const exists = await run(pgBin('psql'), [...args, '-At', '-d', 'postgres', '-c',
  `SELECT 1 FROM pg_database WHERE datname = '${target.replace(/'/g, "''")}'`], { ...env, collect: true });
if (exists.out.trim() !== '1') {
  const created = await run(pgBin('createdb'), [...args, target], env);
  if (created.code !== 0) die(`could not create ${target}: ${created.stderr.trim()}`);
}

try {
  // --clean --if-exists lets a real restore replace objects in an existing target.
  const restored = await run(pgBin('pg_restore'),
    [...args, '--no-owner', '--no-acl', '--clean', '--if-exists', '--exit-on-error', '-d', target, from], env);
  if (restored.code !== 0) die(`restore failed: ${restored.stderr.trim()}`);

  // Report what actually landed. "It restored without error" is not the same as
  // "the data is there" — an empty dump restores perfectly.
  const counts = await run(pgBin('psql'), [...args, '-At', '-F', ' ', '-d', target, '-c',
    `SELECT
       (SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'),
       (SELECT COUNT(DISTINCT trigger_name) FROM information_schema.triggers WHERE trigger_schema = 'public'),
       (SELECT COUNT(*) FROM evidence),
       (SELECT COUNT(*) FROM user_account)`], { ...env, collect: true });

  if (counts.code === 0) {
    const [tables, triggers, evidence, users] = counts.out.trim().split(/\s+/);
    console.log(`[restore] tables=${tables} triggers=${triggers} evidence=${evidence} users=${users}`);
    // The audit-immutability triggers are part of the security model (ADR-0012).
    // A restore that silently lost them yields a database that accepts audit
    // deletions — which is exactly the thing an audit log exists to prevent.
    if (Number(triggers) === 0) {
      die('restored database has NO triggers — audit immutability would be gone.');
    }
  } else {
    console.warn(`[restore] could not read counts: ${counts.stderr.trim()}`);
  }

  console.log(`\n[restore] OK  ${dryRun ? 'drill passed' : `restored into ${target}`}\n`);
} finally {
  if (dryRun) {
    await run(pgBin('dropdb'), [...args, '--if-exists', target], env);
    console.log('[restore] drill database dropped');
  }
}
