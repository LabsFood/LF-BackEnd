/**
 * @deprecated Prisma 7 reads `prisma.config.ts` directly. Prefer `npm run db:*` scripts.
 * Kept for backwards compatibility with custom CLI argument forwarding.
 */
import { execSync } from 'child_process';
import { resolve } from 'path';

import { loadRepoEnv } from '../src/config/env-files';

loadRepoEnv();

if (!process.env.SUPABASE_DB_MIGRATION_URL && process.env.SUPABASE_DB_URL) {
  process.env.SUPABASE_DB_MIGRATION_URL = process.env.SUPABASE_DB_URL;
}

const args = process.argv.slice(2).join(' ');
const appsDir = resolve(__dirname, '..');

execSync(`npx prisma ${args}`, {
  stdio: 'inherit',
  cwd: appsDir,
  env: process.env,
});
