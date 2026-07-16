#!/usr/bin/env node
/**
 * run-gitleaks.mjs — local secret-scan runner (SEIP-QA-001)
 *
 * CI runs the pinned gitleaks binary directly (see .github/workflows/ci.yml).
 * Locally this tries, in order: gitleaks on PATH → docker image. If neither
 * exists it fails with install instructions — a secret scan that silently
 * passes without scanning would be worse than an honest failure.
 */
import { execSync, spawnSync } from 'node:child_process';

const ARGS = 'detect --source . --redact --no-banner';

const has = (cmd) => {
  const probe = process.platform === 'win32' ? `where ${cmd}` : `command -v ${cmd}`;
  try { execSync(probe, { stdio: 'ignore', shell: true }); return true; } catch { return false; }
};

if (has('gitleaks')) {
  const r = spawnSync(`gitleaks ${ARGS}`, { stdio: 'inherit', shell: true });
  process.exit(r.status ?? 1);
}

if (has('docker')) {
  console.log('gitleaks not on PATH — using docker image (pinned)');
  const r = spawnSync(
    `docker run --rm -v "${process.cwd()}:/repo" zricethezav/gitleaks:v8.18.4 ${ARGS.replace('--source .', '--source /repo')}`,
    { stdio: 'inherit', shell: true },
  );
  process.exit(r.status ?? 1);
}

console.error(`gitleaks is not available locally.
Install one of:
  - scoop install gitleaks          (Windows)
  - brew install gitleaks           (macOS)
  - docker (the script will use the pinned image)
CI runs this gate on every push/PR regardless — see "Gate: secret scan".`);
process.exit(1);
