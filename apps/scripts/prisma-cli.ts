/**
 * Runs Prisma CLI with repo-root `.env` loaded and migration URL fallback.
 */
import { execSync } from 'child_process';
import { resolve } from 'path';

import { loadRepoEnv } from '../src/config/env-files';

loadRepoEnv();

if (!process.env.SUPABASE_DB_MIGRATION_URL && process.env.SUPABASE_DB_URL) {
  process.env.SUPABASE_DB_MIGRATION_URL = process.env.SUPABASE_DB_URL;
}

if (!process.env.SUPABASE_DB_URL) {
  console.error(
    'SUPABASE_DB_URL is required. Set it in repo-root .env (see docs/database-connection.md).',
  );
  process.exit(1);
}

const args = process.argv.slice(2).join(' ');
const appsDir = resolve(__dirname, '..');

execSync(`npx prisma ${args}`, {
  stdio: 'inherit',
  cwd: appsDir,
  env: process.env,
});
