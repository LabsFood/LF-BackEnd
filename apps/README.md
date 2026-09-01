# lf-api-nestjs

Primary backend for Labs Food: **NestJS 11 + Fastify** REST API documented via
OpenAPI/Swagger, backed by **Prisma 7** + `@prisma/adapter-pg` + Supabase Postgres. Redis is scaffolded but not enabled yet.

Prisma CLI config: [`prisma.config.ts`](./prisma.config.ts). Generated client: `src/generated/prisma/` (created by `prisma generate`).

Product specs: [`../docs/SPEC-BACKEND.md`](../docs/SPEC-BACKEND.md), [`../docs/SPEC-ADMIN-DASHBOARD.md`](../docs/SPEC-ADMIN-DASHBOARD.md). Backlog: [`../docs/evolution/platform-spec-alignment-evolution.md`](../docs/evolution/platform-spec-alignment-evolution.md).

## Local development

```bash
# from the repo root, start the backing services
docker compose up -d postgres

cd apps
npm install
cp ../../.env.example ../../.env   # if not done yet, fill values (see docs/database-connection.md)
export SUPABASE_DB_URL="postgresql://lf:lf@localhost:5432/lf_backend"
export SUPABASE_DB_MIGRATION_URL="${SUPABASE_DB_MIGRATION_URL:-$SUPABASE_DB_URL}"
npm run db:migrate
npm run db:seed   # optional — F19 concept page
npm run start:dev
```

**Local**

| Endpoint | URL |
|----------|-----|
| Swagger UI | http://localhost:8000/docs |
| OpenAPI JSON | http://localhost:8000/openapi.json |
| Health | http://localhost:8000/health |
| Readiness | http://localhost:8000/ready |

**Production (Railway)** — use the **public** domain from Railway → **Networking** (`https://<public-domain>/…`).  
`https://lf-backend.railway.internal/…` is private and will not work from your browser.

| Endpoint | URL |
|----------|-----|
| Swagger UI | `https://lf-api.labsfood.fr/docs` |
| OpenAPI JSON | `https://lf-api.labsfood.fr/openapi.json` |
| Health | `https://lf-api.labsfood.fr/health` |
| Readiness | `https://lf-api.labsfood.fr/ready` |

See [`../docs/deploy/railway.md`](../docs/deploy/railway.md) for deploy and smoke-test commands.

## F19 — Concept CMS (`/content/concept`)

Implemented in **`ContentCmsModule`** (`src/modules/content-cms/`). Routes stay under `/content/concept` per the API contract.

| Method | Path | Auth |
|--------|------|------|
| `GET` | `/content/concept` | Public |
| `PUT` | `/content/concept` | Clerk bearer + persisted `admin` role |

```bash
# Public read
curl -s http://localhost:8000/content/concept | jq .

# Admin update (generate a local JWT per AGENTS.md, ensure user.role = admin in DB)
curl -s -X PUT http://localhost:8000/content/concept \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d @concept-payload.json
```

Optional Supabase Storage for CMS images: set `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and `SUPABASE_CMS_ASSETS_BUCKET` in `.env` (see repo `.env.example`).

## Admin users (`/admin/users`)

Documented in [`../docs/auth/clerk-integration-contract.md`](../docs/auth/clerk-integration-contract.md). Sign-in/sign-up stay on the Next.js Clerk frontend; these routes are for admin provisioning and RBAC only.

| Method | Path | Auth |
|--------|------|------|
| `POST` | `/admin/users` | Clerk bearer + persisted `admin` role + real `CLERK_SECRET_KEY` |
| `PATCH` | `/admin/users/:id/role` | Clerk bearer + persisted `admin` role |

```bash
# Promote your test user to admin first (Prisma Studio or SQL), then:
curl -s -X POST http://localhost:8000/admin/users \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"email":"chef@example.com","firstName":"Chef","role":"chef"}'
```

## Payments (`/payments`, `/webhooks/stripe`)

`PaymentsModule` (`src/modules/payments/`) + `StripeWebhooksModule` (`src/modules/stripe-webhooks/`).
Full contract: [`../docs/payments/stripe-payments-contract.md`](../docs/payments/stripe-payments-contract.md).

| Method | Path | Auth |
|--------|------|------|
| `POST` | `/payments/intent` | Clerk bearer (booking owner) |
| `POST` / `GET` | `/me/chef-profile/stripe-connect/link` · `/status` | Clerk bearer (chef) |
| `POST` / `GET` | `/me/chef-profile/sepa-mandate/setup-intent` · `/me/chef-profile/sepa-mandate` | Clerk bearer (chef) |
| `GET` / `PATCH` | `/me/chef-profile/sap` | Clerk bearer (chef) |
| `GET` | `/me/fiscal-attestations/:year` | Clerk bearer |
| `GET` | `/admin/fiscal-attestations[/:clientId]` | Clerk bearer + persisted `admin` role |
| `POST` | `/webhooks/stripe` | Stripe signature (public, hidden from Swagger) |

```bash
# Create a PaymentIntent for a pending booking you own
curl -s -X POST http://localhost:8000/payments/intent \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"bookingId":"<uuid>"}'

# Replay webhooks locally
stripe listen --forward-to localhost:8000/webhooks/stripe
stripe trigger payment_intent.succeeded
```

Needs `STRIPE_SECRET_KEY` (else `503`) and `STRIPE_WEBHOOK_SECRET` for the webhook. Commission
rate: `PAYMENTS_COMMISSION_RATE_BPS` (default `1500` — **a placeholder**).

## Run with Docker Compose

From the repo root:

```bash
docker compose up --build api
```

The `api` container runs `prisma migrate deploy` before starting the API.

## Scripts

| Command | Purpose |
|---------|---------|
| `npm run build` | `prisma generate` + compile to `dist/` |
| `npm run start:dev` | Watch mode with hot reload |
| `npm run start:prod` | Run the compiled `dist/main.js` |
| `npm run lint` | ESLint + Prettier check |
| `npm test` | Jest unit tests |
| `npm run db:migrate` | Apply pending Prisma migrations (`deploy`) |
| `npm run db:resolve` | Mark a migration applied (TypeORM baseline) |
| `npm run db:seed` | Seed CMS concept page |
| `npm run db:migrate:dev` | Create/apply migrations in dev |
| `npm run db:studio` | Prisma Studio |
