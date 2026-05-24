# Supabase Postgres connection (LF-BackEnd)

The NestJS API uses **Prisma** against PostgreSQL. Hosted Supabase typically needs **two connection URLs** (pooler for runtime, direct for migrations). Local Docker Postgres can use one URL for both.

## Environment variables

| Variable | Required | Use |
|----------|----------|-----|
| `SUPABASE_DB_URL` | Yes | **Runtime** Prisma (`PrismaService`, `/ready`). Use the **connection pooler** in cloud. |
| `SUPABASE_DB_MIGRATION_URL` | No (recommended on Supabase) | **Migrations only** (`npm run db:migrate`). Use the **direct** connection (port 5432). CLI falls back to `SUPABASE_DB_URL` when unset. |
| `DATABASE_URL` | No (deprecated) | Fallback for `migrationDbUrl` in config loader only. Prefer the vars above. |

Optional Supabase API (Storage, not Postgres): `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY`, `SUPABASE_CMS_ASSETS_BUCKET`.

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

| File | Loaded? |
|------|---------|
| Repo-root `.env` | Yes (Nest `ConfigModule` and Prisma CLI via `scripts/prisma-cli.ts`) |
| Repo-root `.env.local` | Yes, after `.env` (overrides) |
| `apps/.env` | No — keep secrets at repo root |

Commands run from `cd apps` still read repo-root env files automatically.

## Prisma commands

```bash
cd apps
npm install
npm run db:migrate      # apply migrations (deploy)
npm run db:seed         # seed F19 concept page (optional; API has defaults)
npm run db:migrate:dev  # create/apply migrations in development
npm run db:studio       # Prisma Studio GUI
```

Schema: `apps/prisma/schema.prisma`. Migrations: `apps/prisma/migrations/`.

## Prisma baseline (existing TypeORM databases)

If the database was created with the former TypeORM migrations (`typeorm_migrations` table) and already has `users`, `bookings`, `cms_pages`, etc.:

1. Ensure `SUPABASE_DB_MIGRATION_URL` points at the **direct** session.
2. Mark the Prisma baseline as applied without re-running DDL:

```bash
cd apps
npm run db:migrate -- migrate resolve --applied 20250522120000_init
```

3. Optionally drop the legacy table: `DROP TABLE IF EXISTS typeorm_migrations;`

For a **fresh** Postgres volume, run `npm run db:migrate` then `npm run db:seed`.

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
export CLERK_SECRET_KEY="sk_test_placeholder"
npm run start:dev
curl -s http://localhost:8000/ready | jq .
```

Readiness checks Postgres via the **runtime** URL (`SUPABASE_DB_URL`).
