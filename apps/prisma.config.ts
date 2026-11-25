import { defineConfig } from 'prisma/config';

import { loadRepoEnv } from './src/config/env-files';
import { prismaCliUrl } from './src/supabase/db-connection';

loadRepoEnv();

/** Direct Postgres URL for Prisma CLI (migrations, studio). */
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
  },
  datasource: {
    // Verifies the Supabase certificate: the CLI's driver accepts any certificate otherwise.
    url: prismaCliUrl(url),
  },
});
