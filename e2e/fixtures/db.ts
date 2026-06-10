import { execSync } from 'node:child_process';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '../..');

/**
 * Re-seed demo accounts + catalog via the API's seed script (idempotent upserts).
 * Does NOT clear user-generated rows — call this after manually clearing if needed.
 * Full clear+reseed is implemented in T8.2 once test isolation requirements are clear.
 */
export async function resetAndSeed(): Promise<void> {
  execSync('pnpm -F @app/api db:seed', { cwd: ROOT, stdio: 'pipe' });
}
