# Deploy LF-BackEnd on Railway

Production runs the **NestJS API** from [`apps/Dockerfile`](../../apps/Dockerfile) against **Supabase Postgres** (not the Compose `postgres` service). Config is twelve-factor: set variables in the Railway service dashboard (or linked shared variables).

## 1. Create the service

1. [Railway](https://railway.com/) → **New Project** → **Deploy from GitHub repo** → select `LF-BackEnd`.
2. Railway reads [`railway.toml`](../../railway.toml): Docker build from `apps/Dockerfile`, health check `GET /health`.
3. Do **not** deploy the Compose `postgres` service on Railway; use Supabase for the database.

## 2. Environment variables

Set these on the **API service** (Production). Mark secrets as **secret** in Railway.

### Required

| Variable                    | Notes                                                                                                                                                                                                                                     |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `NODE_ENV`                  | `production`                                                                                                                                                                                                                              |
| `ENVIRONMENT`               | `production`                                                                                                                                                                                                                              |
| `DEBUG`                     | `false`                                                                                                                                                                                                                                   |
| `API_HOST`                  | `0.0.0.0`                                                                                                                                                                                                                                 |
| `SUPABASE_DB_URL`           | **Transaction pooler** (port **6543**, `?pgbouncer=true`). Runtime Prisma + `/ready`.                                                                                                                                                     |
| `SUPABASE_DB_MIGRATION_URL` | **Session pooler** or **direct** (port **5432**). Used only at container start for `prisma migrate deploy`. If direct `db.<ref>.supabase.co` is unreachable from Railway (P1001), use the **session pooler** string on port 5432 instead. |
| `CLERK_SECRET_KEY`          | Production Clerk secret (`sk_live_…`).                                                                                                                                                                                                    |

### Port (Railway networking)

Railway injects **`PORT`**. The app listens on `API_PORT`, or **`PORT`** when `API_PORT` is unset — you usually do **not** need to set `API_PORT` manually.

Optional override: set `API_PORT` explicitly if you use a fixed internal port.

### CORS

| Variable       | Example                                                                                                                                                                                                                                                                                                                                                                                                                               |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CORS_ORIGINS` | **Optional.** The product frontends (`https://labsfood.fr`, `https://www.labsfood.fr`, `https://batchcooking.labsfood.fr`) are already allowlisted in [`apps/src/config/allowed-origins.ts`](../../apps/src/config/allowed-origins.ts). Set this only for extra origins — preview deploys, tunnels, staging: `https://preview-abc.vercel.app,https://staging.labsfood.fr`. Exact scheme + host + port, comma-separated, no wildcards. |

### Integrations (set when the feature is live)

| Variable | When needed |
|----------|-------------|
| `CLERK_WEBHOOK_SIGNING_SECRET` | Clerk webhooks → `POST /webhooks/clerk` (`user.created` / `user.updated` / `user.deleted`) |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_CONNECT_WEBHOOK_SECRET` | Payments — **live**. Without the key `/payments/*` answers `503`; without the Connect secret `account.updated` is rejected and chefs stay `chargesEnabled=false` |
| `PAYMENTS_COMMISSION_RATE_BPS`, `PAYMENTS_COMMISSION_VAT_RATE_BPS` | Platform commission in basis points (defaults `1500` / `2000`). Fallback until an admin saves the rate from the console (`PATCH /admin/settings/commission`) |
| `PAYMENTS_COMMISSION_DEBIT_TRIGGER`, `PAYMENTS_COMMISSION_DEBIT_MAX_ATTEMPTS`, `PAYMENTS_COMMISSION_INVOICE_PREFIX` | Commission debits on CESU payments (defaults `on_payment`, `3`, `LF-COM`) |
| `URSSAF_GATEWAY` | Immediate advance: `disabled` (default) or `simulated`. `simulated` is refused beside a live Stripe key |
| `STRIPE_CONNECT_RETURN_URL`, `STRIPE_CONNECT_REFRESH_URL` | Where Stripe returns a chef after Connect onboarding — production batchcooking-web routes, not `localhost:3005` |
| `CRONOFY_CLIENT_ID`, `CRONOFY_CLIENT_SECRET`, `CRONOFY_DATA_CENTER` | Calendar — not used yet |
| `BREVO_API_KEY`, `BREVO_SENDER_EMAIL`, `BREVO_SENDER_NAME` | Email |
| `GOOGLE_MAPS_API_KEY` | Maps — not used yet |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY` | Supabase Storage client (KYC documents and message attachments) |
| `SUPABASE_KYC_BUCKET` | Chef onboarding KYC documents — **private bucket, no public read policy** |
| `SUPABASE_MESSAGING_BUCKET` | Message attachments — **private bucket**. Without it the attachment routes answer 503 |
| `REDIS_URL` | Messaging rate limit and realtime fan-out. Required once the API runs on more than one instance |
| `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, `R2_PUBLIC_BASE_URL` | Dish, menu and profile photos on Cloudflare R2 (public bucket). All five, or the photo routes answer 503 `PHOTOS_UNAVAILABLE` |
| `BREVO_TPL_*` (19 ids) | One per email: chef onboarding, dishes, messaging, contact forms, custom requests (see [`brevo/README.md`](../../brevo/README.md)). An unset id skips that email with a warning. **`BREVO_API_KEY` and `BREVO_TPL_APPLICATION_RECEIVED` are required wherever candidatures are accepted** — that email carries the only sign-in link to the new account — and `BREVO_TPL_SIGN_IN_LINK` for the admin resend |
| `CONTACT_NOTIFICATION_EMAIL`, `ADMIN_SITE_URL` | Team address told about contact messages and custom requests with no batch cooker (Reply-To of the answers), and the admin console link in those emails. Without `BREVO_TPL_CONTACT_REPLY` an admin cannot answer a contact message |
| `PUBLIC_SITE_URL`, `CHEF_APPLICATION_ADMIN_EMAIL` | The batch cooking site (default `https://batchcooking.labsfood.fr`) for the sign-in, dossier and dashboard links in the chef-onboarding emails — it must use the **same Clerk instance** as `CLERK_SECRET_KEY`, or the sign-in link is refused — and the internal new-candidature notification |
| `LOG_JSON`, `LOG_LEVEL` | Structured logging — see §7 |

Copy URI formats from [`docs/database-connection.md`](../database-connection.md).

### KYC bucket (chef onboarding)

Create the bucket named by `SUPABASE_KYC_BUCKET` in Supabase Storage and leave
it **private**. It holds identity documents; a public read policy on it is a
personal-data breach, not a misconfiguration. The API never produces a public
URL for it — uploads use a signed PUT, reads a 5-minute signed GET, and every
read is written to `audit_log`.

### Dish photos bucket (FLOW-02)

Create an R2 bucket for dish, menu and profile photos and give it a public address (a custom domain,
or the bucket's r2.dev URL) in `R2_PUBLIC_BASE_URL`: the public site loads photos
from there. Browsers upload straight to it with a presigned `PUT`, so its CORS
policy must allow `PUT` with the `Content-Type` header from the site origins. The
API token needs object read and write on that bucket only. Serve the public domain
with `X-Content-Type-Options: nosniff` (a Cloudflare response header rule): the API
checks each photo's bytes, and this stops a browser from second-guessing the type.

## 3. Database URLs (Supabase)

1. Supabase → **Connect** → **Transaction pooler** (port **6543**, `?pgbouncer=true`) → `SUPABASE_DB_URL` (runtime + `/ready`).
2. **Session pooler** or **Direct connection** (port **5432**) → `SUPABASE_DB_MIGRATION_URL` (migrations only).

Never run migrations through the **transaction** pooler (6543). The container entrypoint runs `prisma migrate deploy` once per deploy using `SUPABASE_DB_MIGRATION_URL` (see `apps/scripts/docker-entrypoint.sh`).

## 4. Public domain & API URLs

### Public vs private networking

| URL type             | Example                                             | Who can call it                                         |
| -------------------- | --------------------------------------------------- | ------------------------------------------------------- |
| **Public domain**    | `https://lf-backend-production-xxxx.up.railway.app` | Browsers, frontends, `curl` from your machine, webhooks |
| **Private internal** | `http://lf-backend.railway.internal:<PORT>`         | Other Railway services in the same project only         |

`*.railway.internal` is **not** reachable from the public internet. If Swagger or `/ready` return nothing in a browser, you are likely using the internal hostname — use the **public domain** from Networking instead.

### Generate the public domain

1. Service → **Settings** → **Networking** → **Generate domain** (or attach a custom domain).
2. Copy the HTTPS URL (e.g. `https://lf-backend-production-xxxx.up.railway.app`). This is `<public-domain>` below.
3. **Health check** (from `railway.toml`): path **`/health`** (liveness, no DB).

### Endpoints (production)

Replace `<public-domain>` with your Railway public hostname (no trailing slash).

| Endpoint     | URL                                    | Notes                                  |
| ------------ | -------------------------------------- | -------------------------------------- |
| Swagger UI   | `https://<public-domain>/docs`         | Interactive API explorer               |
| OpenAPI JSON | `https://<public-domain>/openapi.json` | Machine-readable spec                  |
| Health       | `https://<public-domain>/health`       | Liveness; Railway probes this          |
| Readiness    | `https://<public-domain>/ready`        | DB ping via `SUPABASE_DB_URL` (pooler) |

### Smoke test after deploy

```bash
export API_BASE="https://<public-domain>"

curl -s "$API_BASE/health"
curl -s "$API_BASE/ready"
curl -s "$API_BASE/openapi.json" | head -c 200
```

| Path      | Use                                               |
| --------- | ------------------------------------------------- |
| `/health` | Railway health check, load balancer liveness      |
| `/ready`  | Readiness (DB ping); use after deploy smoke tests |
| `/docs`   | Swagger UI                                        |

## 4b. Logs and debugging

Set `LOG_JSON=true` in production (it is the default when `ENVIRONMENT=production`).
Both the application logs and the Fastify access logs then emit JSON lines, so
Railway's log explorer can filter on fields instead of matching substrings.
`LOG_LEVEL` accepts `fatal | error | warn | info | debug | trace`, default `info`.

Every response carries an `x-request-id` header. An inbound `x-request-id` from
a proxy is honoured, so a trace survives across services.

**Joining a log line to the database.** The same id is stored on
`audit_log.request_id`. Railway's log retention is short and cannot be queried
by candidature, so the durable trail is in Postgres:

```sql
-- everything that happened to one candidature
SELECT created_at, actor_type, action, outcome, request_id, metadata
FROM audit_log WHERE subject_id = '<application uuid>' ORDER BY created_at;

-- recent failures across the platform
SELECT created_at, action, subject_id, metadata->>'error' AS error
FROM audit_log WHERE outcome = 'failed' ORDER BY created_at DESC LIMIT 50;

-- who opened which identity document
SELECT a.created_at, u.email, a.metadata
FROM audit_log a LEFT JOIN users u ON u.id = a.actor_user_id
WHERE a.action = 'document.read' ORDER BY a.created_at DESC;
```

## 4c. Scheduled jobs

Three jobs run in-process via `@nestjs/schedule`. There is no queue.

| Job | When | What |
|-----|------|------|
| `ChefDossierCron` | daily, 06:00 | Document expiry warnings, automatic suspension, retention purge |
| `MessagingNotifierCron` | every 5 minutes | Emails a participant whose messages stayed unread 10 minutes |
| `quote-offers-expiry` | every 10 minutes | Expires offers past `validUntil` |

**If you scale the API past one replica, every replica will run them.** The
messaging and offer jobs claim their rows, so a double run is harmless. The
chef-dossier steps are idempotent, but move that job to a queue or a Postgres
advisory lock before relying on that at scale. See `ChefDossierCron`.

## 5. Deploy flow

On each deploy Railway:

1. Builds `apps/Dockerfile` (context: repository root `.`).
2. Starts container → entrypoint runs **`prisma migrate deploy`** → **`node dist/main.js`**.
3. Probes **`/health`** until success.

## 6. Local Docker vs Railway

|          | Local Compose              | Railway                  |
| -------- | -------------------------- | ------------------------ |
| Database | `postgres` service         | Supabase                 |
| Build    | `docker compose build api` | Git push / Railway build |
| Env      | Repo-root `.env`           | Railway dashboard        |

See **Getting started → Docker Compose** in the main [README](../../README.md).

## Blockers checklist (you must supply)

- [ ] Supabase project with **pooler** + **direct** connection strings
- [ ] `CLERK_SECRET_KEY` (production)
- [ ] Frontend origins — check [`apps/src/config/allowed-origins.ts`](../../apps/src/config/allowed-origins.ts), add anything extra via `CORS_ORIGINS`
- [ ] **Stripe live keys + Connect enabled** (Express accounts, FR) — payments are shipped
- [ ] Brevo key and template ids, R2 keys, Supabase buckets (KYC, messaging)
- [ ] Clerk webhook `https://<api-domain>/webhooks/clerk` + `CLERK_WEBHOOK_SIGNING_SECRET`
- [ ] Two Stripe webhook endpoints on `https://<api-domain>/webhooks/stripe`: "Your account" + `STRIPE_WEBHOOK_SECRET`, "Connected accounts" (`account.updated`) + `STRIPE_CONNECT_WEBHOOK_SECRET` — events in [`../payments/stripe-payments-contract.md`](../payments/stripe-payments-contract.md) §6
- [ ] Commission rate saved from the admin console (until then `PAYMENTS_COMMISSION_RATE_BPS`, 15 % HT)

Redis is optional with one API instance. Set `REDIS_URL` (Railway Redis plugin) before running a second instance: without it, a message posted on one instance never reaches a WebSocket held by the other. Messaging also needs the private Supabase bucket `SUPABASE_MESSAGING_BUCKET` for attachments, and `BREVO_TPL_NEW_MESSAGE` for the unread-message email.
