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

# The Brevo templates of the repo (brevo/templates/): create the missing ones, then
# report how each compares with Brevo. Never blocks the start: Brevo down, or a
# template edited in Brevo, is logged and the API starts with what Brevo holds. The
# API finds the ids by name (BrevoService.onModuleInit): no Railway variable needed.
# ponytail: two replicas starting at once could both create a missing template;
# start one replica first if that ever happens (duplicates are deleted in Brevo).
if [ -n "${BREVO_API_KEY:-}" ]; then
  echo "Creating missing Brevo templates (brevo/upload.mjs)..."
  node brevo/upload.mjs || echo "WARN: Brevo template upload failed; starting anyway." >&2
  echo "Comparing Brevo with the repo (brevo/upload.mjs --check)..."
  node brevo/upload.mjs --check || echo "WARN: some Brevo templates differ from the repo (see above)." >&2
else
  echo "WARN: BREVO_API_KEY unset; Brevo templates not checked." >&2
fi

echo "Starting NestJS API..."
exec node dist/main.js
