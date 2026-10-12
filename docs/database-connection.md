# Supabase Postgres connection (LF-BackEnd)

The NestJS API uses **Prisma** against PostgreSQL. Hosted Supabase typically needs **two connection URLs** (pooler for runtime, direct for migrations). Local Docker Postgres can use one URL for both.

## Environment variables

| Variable                    | Required                     | Use                                                                                                                                    |
| --------------------------- | ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `SUPABASE_DB_URL`           | Yes                          | **Runtime** Prisma (`PrismaService`, `/ready`). Use the **connection pooler** in cloud.                                                |
| `SUPABASE_DB_MIGRATION_URL` | No (recommended on Supabase) | **Migrations only** (`npm run db:migrate`). Use the **direct** connection (port 5432). CLI falls back to `SUPABASE_DB_URL` when unset. |
| `DATABASE_URL`              | No (deprecated)              | Fallback for `migrationDbUrl` in config loader only. Prefer the vars above.                                                            |

Supabase API (Storage, not Postgres): `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY`, and `SUPABASE_KYC_BUCKET` for chef KYC documents.

## URI formats (placeholders)

**Local (docker compose):**

```env
SUPABASE_DB_URL=<postgresql://lf:lf@localhost:5432/lf_backend>
SUPABASE_DB_MIGRATION_URL=<postgresql://lf:lf@localhost:5432/lf_backend>
```

**Supabase cloud — runtime (Transaction pooler, port 6543):**

```env
SUPABASE_DB_URL=postgresql://postgres.[PROJECT_REF]:[PASSWORD]@aws-0-[REGION].pooler.supabase.com:6543/postgres?pgbouncer=true
```

**Supabase cloud — migrations (Direct, port 5432):**

```env
SUPABASE_DB_MIGRATION_URL=postgresql://postgres.[PROJECT_REF]:[PASSWORD]@db.[PROJECT_REF].supabase.co:5432/postgres
```

Copy both strings from the Supabase dashboard: **Project → Connect → ORMs / Connection string**, choosing **Transaction pooler** for `SUPABASE_DB_URL` and **Direct connection** for `SUPABASE_DB_MIGRATION_URL`.

## Where to get URIs

1. Open [Supabase Dashboard](https://supabase.com/dashboard) → your project.
2. **Connect** (or **Settings → Database**).
3. **Transaction pooler** → `SUPABASE_DB_URL` (port **6543**, include `?pgbouncer=true` when shown).
4. **Direct connection** → `SUPABASE_DB_MIGRATION_URL` (port **5432**).
5. Store values in repo-root `.env` (never commit). Optional overrides in `.env.local`. Restart the API after changes.

### Env file location

| File                   | Loaded?                                                              |
| ---------------------- | -------------------------------------------------------------------- |
| Repo-root `.env`       | Yes (Nest `ConfigModule` and Prisma CLI via `scripts/prisma-cli.ts`) |
| Repo-root `.env.local` | Yes, after `.env` (overrides)                                        |
| `apps/.env`            | No — keep secrets at repo root                                       |

Commands run from `cd apps` still read repo-root env files automatically.

## Prisma commands (ORM 7)

Configuration lives in **`apps/prisma.config.ts`** (database URL for CLI, migrations path). The schema is at `apps/prisma/schema.prisma`; URLs are no longer defined in the schema file.

```bash
cd apps
npm install
npm run db:migrate      # apply migrations (deploy)
npm run db:migrate:dev  # create/apply migrations in development
npm run db:studio       # Prisma Studio GUI
```

`prisma generate` runs on `postinstall` and `npm run build`. The client is emitted to `apps/src/generated/prisma/` (gitignored; regenerated locally/CI).

## Prisma baseline (existing TypeORM databases)

If the database was created with the former TypeORM migrations (`typeorm_migrations` table) and already has `users`, `bookings`, etc.:

1. Ensure `SUPABASE_DB_MIGRATION_URL` points at the **direct** session.
2. Mark existing Prisma migrations as applied **without** re-running DDL (`db:migrate` only runs `deploy` — use `db:resolve` for this):

```bash
cd apps
# TypeORM baseline already has the Phase 1 tables:
npm run db:resolve -- --applied 20250522120000_init

# If spec_domain tables also already exist, mark that migration too:
npm run db:resolve -- --applied 20250522130000_spec_domain
```

3. Apply any remaining migrations:

```bash
npm run db:migrate
```

4. Optionally drop the legacy table: `DROP TABLE IF EXISTS typeorm_migrations;`

For a **fresh** Postgres volume, run `npm run db:migrate`.

## Partially applied migrations

**Prisma does not wrap a migration file in a transaction.** If a statement fails half-way
through, everything before it is already committed, the migration is recorded as *failed*, and
the next `migrate deploy` replays the file **from the top** — straight into
`type "x" already exists` on the objects the first attempt created.

Migrations in this repo that alter pre-existing objects are therefore written to be
**idempotent**: `CREATE TYPE` inside a `DO $$ … EXCEPTION WHEN duplicate_object $$`, `IF EXISTS` /
`IF NOT EXISTS` on every `ALTER`, and `ADD VALUE IF NOT EXISTS` on enum values. See
`20260524173000_provider_role_to_chef` and `20260831120000_payments_sap_sepa_foundations` — the
latter failed this way twice during development before it was made idempotent.

If a deploy still leaves a migration in the failed state:

```bash
cd apps
npx prisma migrate status                                  # which migration is failed
npm run db:resolve -- --rolled-back <migration_name>       # after undoing its effects by hand
# or, when the file is idempotent and its effects are already in place:
npm run db:resolve -- --applied <migration_name>
npm run db:migrate
```

Write new migrations that touch existing tables or enums the same way, or a single production
failure will need manual SQL to unblock.

## Behavior in this repo

- `PrismaService` connects with `SUPABASE_DB_URL` at API startup.
- Docker `api` service runs `prisma migrate deploy` before `node dist/main.js` (see `apps/Dockerfile`).
- Cloud hosts (`*.supabase.co`) use TLS via the connection string / Prisma defaults.

## Verify

```bash
docker compose up -d postgres

cd apps
npm run db:migrate
export SUPABASE_DB_URL="postgresql://lf:lf@localhost:5432/lf_backend"
export CLERK_SECRET_KEY="<sk_test_placeholder>"
npm run start:dev
curl -s http://localhost:8000/ready | jq .
```

Readiness checks Postgres via the **runtime** URL (`SUPABASE_DB_URL`).

## Railway production

Hosted API on Railway uses **Supabase** (not Compose Postgres). Set both URLs in the Railway service:

- `SUPABASE_DB_URL` — **transaction** pooler (6543) for the running app and `/ready`
- `SUPABASE_DB_MIGRATION_URL` — **session** pooler or **direct** (5432) for `prisma migrate deploy` on each deploy

The container entrypoint runs migrations then starts the API. Full steps: [`docs/deploy/railway.md`](deploy/railway.md).

### Verify production (public URL)

Use the **public** Railway domain from **Networking** :

```bash
export API_BASE="https://<public-domain>"   # e.g. https://lf-backend-production-xxxx.up.railway.app

curl -s "$API_BASE/health"
curl -s "$API_BASE/ready"
```

- Swagger: `$API_BASE/docs`
- OpenAPI: `$API_BASE/openapi.json`
