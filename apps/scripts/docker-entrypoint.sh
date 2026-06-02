#!/bin/sh
set -eu

if [ -z "${SUPABASE_DB_URL:-}" ]; then
  echo "ERROR: SUPABASE_DB_URL is required (runtime pooler URL in production)." >&2
  exit 1
fi

if [ -z "${SUPABASE_DB_MIGRATION_URL:-}" ]; then
  export SUPABASE_DB_MIGRATION_URL="${SUPABASE_DB_URL}"
  echo "WARN: SUPABASE_DB_MIGRATION_URL unset; using SUPABASE_DB_URL for prisma migrate deploy." >&2
  echo "      On Supabase production, set SUPABASE_DB_MIGRATION_URL to the direct session (port 5432)." >&2
fi

echo "Running Prisma migrations (migrate deploy)..."
npx prisma migrate deploy

echo "Starting NestJS API..."
exec node dist/main.js
