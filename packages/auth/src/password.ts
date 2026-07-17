// SEC-AUTH-1: adaptive hash only, never logged. Argon2id is OWASP's current
// recommendation (memory-hard, resists GPU cracking better than bcrypt at
// equivalent settings). Parameters follow OWASP's 2024 baseline for argon2id.
import { hash, verify } from '@node-rs/argon2';

const OPTS = {
  memoryCost: 19456, // 19 MiB
  timeCost: 2,
  parallelism: 1,
};

export async function hashPassword(plain: string): Promise<string> {
  return hash(plain, OPTS);
}

export async function verifyPassword(plain: string, stored: string): Promise<boolean> {
  return verify(stored, plain);
}

/**
 * True if a stored hash predates a parameter upgrade — caller should re-hash and
 * re-store on next successful login (transparent rotation, no forced reset).
 * @node-rs/argon2 has no `needsRehash` helper, so this parses the PHC string
 * (`$argon2id$v=19$m=19456,t=2,p=1$...`) and compares against OPTS directly.
 */
export function shouldRehash(stored: string): boolean {
  const m = stored.match(/^\$argon2id\$v=\d+\$m=(\d+),t=(\d+),p=(\d+)\$/);
  if (!m) return true; // not our format at all (e.g. legacy bcrypt) — force upgrade
  const [, memoryCost, timeCost, parallelism] = m.map(Number) as unknown as [number, number, number, number];
  return memoryCost !== OPTS.memoryCost || timeCost !== OPTS.timeCost || parallelism !== OPTS.parallelism;
}
