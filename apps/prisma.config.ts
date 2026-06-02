import { defineConfig } from 'prisma/config';

import { loadRepoEnv } from './src/config/env-files';

loadRepoEnv();

/** Direct Postgres URL for Prisma CLI (migrations, seed, studio). */
function migrationDatabaseUrl(): string {
  return (
    process.env.SUPABASE_DB_MIGRATION_URL ??
    process.env.SUPABASE_DB_URL ??
    process.env.DATABASE_URL ??
    ''
  );
}

const url = migrationDatabaseUrl();
if (!url) {
  throw new Error(
    'Set SUPABASE_DB_URL in repo-root .env (and SUPABASE_DB_MIGRATION_URL for Supabase direct migrations).',
  );
}

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'ts-node --compiler-options {"module":"CommonJS"} prisma/seed.ts',
  },
  datasource: {
    url,
  },
});
