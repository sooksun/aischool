#!/usr/bin/env node
// Runs a Prisma migrate command as the schema owner (ADR-0012 §4).
//
// The app connects as seip_app (DATABASE_URL), which owns nothing and cannot
// run DDL. Migrations connect as seip_migrator via MIGRATE_DATABASE_URL. Prisma
// reads only DATABASE_URL, so this swaps it for the child process — a node
// script rather than `DATABASE_URL=... prisma` so it works the same in
// PowerShell on the Windows dev box and in CI.
//
//   node --env-file-if-exists=.env scripts/db/migrate.mjs deploy
//   node --env-file-if-exists=.env scripts/db/migrate.mjs dev --name <change>
import { spawnSync } from 'node:child_process';

const url = process.env.MIGRATE_DATABASE_URL;
if (!url) {
  console.error('migrate: MIGRATE_DATABASE_URL is required (the seip_migrator connection string)');
  process.exit(1);
}
const args = process.argv.slice(2);
const r = spawnSync('npx', ['prisma', 'migrate', ...(args.length ? args : ['deploy'])], {
  stdio: 'inherit',
  shell: process.platform === 'win32',
  env: { ...process.env, DATABASE_URL: url },
});
process.exit(r.status ?? 1);
