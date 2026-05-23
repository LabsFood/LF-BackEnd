# Supabase Postgres connection (LF-BackEnd)

The NestJS API uses **two connection URLs** when talking to hosted Supabase Postgres. Local Docker Postgres uses a single direct URL for both.

**ORM note:** The target persistence layer is **Prisma** ([`stack.md`](../stack.md)). Until the Prisma migration branch lands, runtime and CLI migrations use **TypeORM** under `apps/src/supabase/`.

## Environment variables

| Variable | Required | Use |
|----------|----------|-----|
| `SUPABASE_DB_URL` | Yes | **Runtime** TypeORM (API, `/ready`). Use the **connection pooler** in cloud. |
| `SUPABASE_DB_MIGRATION_URL` | No (recommended on Supabase) | **Migrations only** (`npm run migration:run`). Use the **direct** connection (port 5432). |
| `DATABASE_URL` | No (deprecated) | Fallback for migrations only if `SUPABASE_DB_MIGRATION_URL` is unset. Prefer renaming to the vars above. |

Optional Supabase API (Storage, not Postgres): `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY`, `SUPABASE_CMS_ASSETS_BUCKET`.

## URI formats (placeholders)

**Local (docker compose):** one URL is enough for app and migrations.

```env
SUPABASE_DB_URL=postgresql://lf:lf@localhost:5432/lf_backend
```

**Supabase cloud — runtime (Transaction pooler, port 6543):**

```env
SUPABASE_DB_URL=postgresql://postgres.[PROJECT_REF]:[PASSWORD]@aws-0-[REGION].pooler.supabase.com:6543/postgres?pgbouncer=true
```

**Supabase cloud — migrations (Direct, port 5432):**

```env
SUPABASE_DB_MIGRATION_URL=postgresql://postgres.[PROJECT_REF]:[PASSWORD]@db.[PROJECT_REF].supabase.co:5432/postgres
```

Copy both strings from the Supabase dashboard: **Project → Connect → ORMs / Connection string**, choosing **Transaction pooler** for `SUPABASE_DB_URL` and **Direct connection** for `SUPABASE_DB_MIGRATION_URL`. Replace `[YOUR-PASSWORD]` with the database password.

## Where to get URIs

1. Open [Supabase Dashboard](https://supabase.com/dashboard) → your project.
2. **Connect** (or **Settings → Database**).
3. **Transaction pooler** → `SUPABASE_DB_URL` (port **6543**, include `?pgbouncer=true` when shown).
4. **Direct connection** → `SUPABASE_DB_MIGRATION_URL` (port **5432**).
5. Store values in repo-root `.env` (never commit). Optional overrides in `.env.local` (also gitignored). Restart the API after changes.

### Env file location

| File | Loaded? |
|------|---------|
| Repo-root `.env` | Yes (Nest `ConfigModule` and TypeORM CLI) |
| Repo-root `.env.local` | Yes, after `.env` (overrides) |
| `apps/.env` | No — keep secrets at repo root |

Commands run from `cd apps` still read repo-root env files automatically.

## Behavior in this repo

- `apps/src/supabase/database.module.ts` connects with `SUPABASE_DB_URL`. Auto-runs migrations only on **local** direct URLs; on pooler URLs, run migrations via CLI.
- `apps/src/supabase/data-source.ts` (TypeORM CLI) prefers `SUPABASE_DB_MIGRATION_URL`, then `SUPABASE_DB_URL`, then `DATABASE_URL`.
- Cloud hosts (`*.supabase.co`) enable TLS automatically.

## Verify

```bash
docker compose up -d postgres redis   # local only

cd apps
npm run migration:run                 # uses migration URL chain
npm run start:dev                     # needs SUPABASE_DB_URL + REDIS_URL + CLERK_SECRET_KEY
curl -s http://localhost:8000/ready | jq .
```

Readiness checks Postgres via the **runtime** URL (`SUPABASE_DB_URL`).
