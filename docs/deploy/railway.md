# Deploy LF-BackEnd on Railway

Production runs the **NestJS API** from [`apps/Dockerfile`](../../apps/Dockerfile) against **Supabase Postgres** (not the Compose `postgres` service). Config is twelve-factor: set variables in the Railway service dashboard (or linked shared variables).

## 1. Create the service

1. [Railway](https://railway.com/) → **New Project** → **Deploy from GitHub repo** → select `LF-BackEnd`.
2. Railway reads [`railway.toml`](../../railway.toml): Docker build from `apps/Dockerfile`, health check `GET /health`.
3. Do **not** deploy the Compose `postgres` service on Railway; use Supabase for the database.

## 2. Environment variables

Set these on the **API service** (Production). Mark secrets as **secret** in Railway.

### Required

| Variable | Notes |
|----------|--------|
| `NODE_ENV` | `production` |
| `ENVIRONMENT` | `production` |
| `DEBUG` | `false` |
| `API_HOST` | `0.0.0.0` |
| `SUPABASE_DB_URL` | **Transaction pooler** (port **6543**, `?pgbouncer=true`). Runtime Prisma + `/ready`. |
| `SUPABASE_DB_MIGRATION_URL` | **Direct** session (port **5432**). Used only at container start for `prisma migrate deploy`. |
| `CLERK_SECRET_KEY` | Production Clerk secret (`sk_live_…`). |

### Port (Railway networking)

Railway injects **`PORT`**. The app listens on `API_PORT`, or **`PORT`** when `API_PORT` is unset — you usually do **not** need to set `API_PORT` manually.

Optional override: set `API_PORT` explicitly if you use a fixed internal port.

### CORS

| Variable | Example |
|----------|---------|
| `CORS_ORIGINS` | Comma-separated production frontends, no spaces required: `https://app.labsfood.com,https://admin.labsfood.com` |

### Integrations (set when the feature is live)

| Variable | When needed |
|----------|-------------|
| `CLERK_WEBHOOK_SIGNING_SECRET` | Clerk webhooks |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | Payments |
| `CRONOFY_CLIENT_ID`, `CRONOFY_CLIENT_SECRET`, `CRONOFY_DATA_CENTER` | Calendar |
| `STREAM_API_KEY`, `STREAM_API_SECRET`, `STREAM_APP_ID` | Chat |
| `BREVO_API_KEY`, `BREVO_SENDER_EMAIL`, `BREVO_SENDER_NAME` | Email |
| `GOOGLE_MAPS_API_KEY` | Maps |
| `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`, `AWS_S3_BUCKET` | S3 |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY`, `SUPABASE_CMS_ASSETS_BUCKET` | CMS assets in Supabase Storage |

Copy URI formats from [`docs/database-connection.md`](../database-connection.md).

## 3. Database URLs (Supabase)

1. Supabase → **Connect** → **Transaction pooler** → `SUPABASE_DB_URL`.
2. **Direct connection** → `SUPABASE_DB_MIGRATION_URL`.

Never run migrations through the pooler. The container entrypoint runs `prisma migrate deploy` once per deploy using `SUPABASE_DB_MIGRATION_URL` (see `apps/scripts/docker-entrypoint.sh`).

Optional one-off seed (not run on deploy):

```bash
# From your machine with repo-root .env or Railway CLI env
cd apps && npm run db:seed
```

## 4. Public domain & health checks

1. Service → **Settings** → **Networking** → **Generate domain** (or attach custom domain).
2. **Health check** (from `railway.toml`): path **`/health`** (liveness, no DB).
3. For manual verification after deploy: `GET https://<your-domain>/ready` (Postgres via pooler).

| Path | Use |
|------|-----|
| `/health` | Railway health check, load balancer liveness |
| `/ready` | Readiness (DB ping); use after deploy smoke tests |
| `/docs` | Swagger UI |

## 5. Deploy flow

On each deploy Railway:

1. Builds `apps/Dockerfile` (context: `apps/`).
2. Starts container → entrypoint runs **`prisma migrate deploy`** → **`node dist/main.js`**.
3. Probes **`/health`** until success.

## 6. Local Docker vs Railway

| | Local Compose | Railway |
|---|---------------|---------|
| Database | `postgres` service | Supabase |
| Build | `docker compose build api` | Git push / Railway build |
| Env | Repo-root `.env` | Railway dashboard |

See **Getting started → Docker Compose** in the main [README](../../README.md).

## Blockers checklist (you must supply)

- [ ] Supabase project with **pooler** + **direct** connection strings
- [ ] `CLERK_SECRET_KEY` (production)
- [ ] `CORS_ORIGINS` for real frontend URLs
- [ ] Stripe / Cronofy / Brevo / Stream / AWS keys when those flows ship
- [ ] Clerk/Stripe webhook URLs pointed at `https://<api-domain>/…` (when implemented)

Redis is **not** required yet (module disabled in repo).
