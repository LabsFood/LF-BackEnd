# AGENTS.md



### Application specifiactions

Consider [`docs/SPEC-BACKEND.md`](docs/SPEC-BACKEND.md) and [`docs/SPEC-ADMIN-DASHBOARD.md`](docs/SPEC-ADMIN-DASHBOARD.md) as the main guide for product intent and API direction. Track gaps and decisions in [`docs/evolution/platform-spec-alignment-evolution.md`](docs/evolution/platform-spec-alignment-evolution.md). Stack and backend architecture: [`stack.md`](stack.md), [`docs/architecture.md`](docs/architecture.md).

### Services overview

| Service | Port | Purpose |
|---------|------|---------|
| NestJS API (primary) | 8000 | REST API — booking, auth, integrations |
| PostgreSQL 16 | 5432 | Primary data store via Supabase Postgres URL (**Prisma**) |
| Redis 7 | 6379 | Cache, queues *(not wired yet — module commented out)* |

### Starting backing services

```bash
# Start Docker daemon (required first)
sudo dockerd &>/tmp/dockerd.log &

# Bring up Postgres (Redis optional — not implemented yet)
sudo docker compose up -d postgres
# sudo docker compose up -d postgres redis
```

### Running the NestJS API (primary)

Either bring up the whole stack with Compose, or run the API locally against
the dockerised Postgres (Redis optional).


``` bash
# Option A — full stack in Docker (Compose v2)
# If `docker compose up --build` errors with unknown flag --build, use:
#   docker compose build api && docker compose up api
sudo docker compose build api && sudo docker compose up api

# Option B — local dev with hot-reload (recommended while iterating)
# Put secrets in repo-root `.env` (optional `.env.local` overrides). No `apps/.env` needed.
cd apps
npm install
export SUPABASE_DB_URL="postgresql://lf:lf@localhost:5432/lf_backend"
# export REDIS_URL="redis://localhost:6379/0"   # not required until Redis is enabled
export CLERK_SECRET_KEY="sk_test_placeholder"   # any non-empty string works locally
export SUPABASE_DB_MIGRATION_URL="${SUPABASE_DB_MIGRATION_URL:-$SUPABASE_DB_URL}"
npm run db:migrate       # apply Prisma migrations once (see docs/database-connection.md)
npm run db:seed          # optional: seed CMS concept page
npm run start:dev        # listens on 8000
```

**Local**

- Swagger UI:  http://localhost:8000/docs
- OpenAPI:     http://localhost:8000/openapi.json
- Health:      http://localhost:8000/health
- Readiness:   http://localhost:8000/ready (pings Postgres)

**Production (Railway public domain)** — copy from Railway → service → **Networking**; do not use `*.railway.internal` in a browser:

- Swagger UI:  `https://lf-api.labsfood.fr/docs`
- OpenAPI:     `https://lf-api.labsfood.fr/openapi.json`
- Health:      `https://lf-api.labsfood.fr/health`
- Readiness:   `https://lf-api.labsfood.fr/ready`

### Database (Prisma)

```bash
cd apps
npm run db:migrate                    # apply pending migrations (deploy)
npm run db:resolve -- --applied <name>  # baseline: mark migration applied without DDL
npm run db:seed                       # seed CMS concept page
npm run db:migrate:dev                # dev: create/apply migrations
npm run db:studio                     # Prisma Studio
```

Docker `api` runs `prisma migrate deploy` on container start (`apps/scripts/docker-entrypoint.sh`, `apps/Dockerfile`). Config: `apps/prisma.config.ts`. Schema: `apps/prisma/schema.prisma`.

### Railway production

Deploy checklist: [`docs/deploy/railway.md`](docs/deploy/railway.md). Config-as-code: [`railway.toml`](railway.toml). Set `SUPABASE_DB_URL` (transaction pooler :6543), `SUPABASE_DB_MIGRATION_URL` (session or direct :5432), `CLERK_SECRET_KEY`, `CORS_ORIGINS`, `NODE_ENV=production`. Health check path: `/health`. Public API base URL: Railway **Networking** domain (see README **API endpoints**).

### Linting and testing

```bash
cd apps
npm run lint        # eslint + prettier
npm run build       # tsc via @nestjs/cli, output to dist/
npm test            # jest unit tests
```

### Auth testing without Clerk

With `CLERK_SECRET_KEY=sk_test_placeholder`, `ClerkAuthGuard` decodes the JWT
payload without JWKS verification so any well-formed JWT with a `sub` claim works
locally. When a real `sk_test_…` / `sk_live_…` key is set, tokens are verified
via `@clerk/backend` (`verifyToken`). Generate a local stub token with Node:

```bash
node -e '
  const h = Buffer.from(JSON.stringify({alg:"HS256",typ:"JWT"})).toString("base64url");
  const p = Buffer.from(JSON.stringify({sub:"user_test_123",email:"test@example.com"})).toString("base64url");
  console.log(`${h}.${p}.signature`);
'
```

Use the token as `Authorization: Bearer <token>` against `/thisUser`, `/me`, or
`/bookings`.

### Clerk webhooks and DB sync

Architecture: [`docs/auth/clerk-supabase-sync.md`](docs/auth/clerk-supabase-sync.md). Frontend/backend boundary: [`docs/auth/clerk-integration-contract.md`](docs/auth/clerk-integration-contract.md).

- Public sign-up (no session): `POST /auth/register` — `email` + `password`, always `role: client`, IP rate-limited. Returns a 60s Clerk sign-in ticket the frontend redeems with `signIn.create({ strategy: 'ticket', ticket })`. Returns `503` with `sk_test_placeholder`.
- Onboarding form 2 (authenticated): `PATCH /me/profile` (client) or `PATCH /me/chef-profile` (chef). **The route sets the role — the body never carries one**; a submitted `role` is a `400`. Chefs land `is_active/is_verified = false` until `PATCH /admin/chefs/:id/verification`.
- Webhook endpoint (public, Svix-verified): `POST /webhooks/clerk` — set `CLERK_WEBHOOK_SIGNING_SECRET` from Clerk Dashboard.
- One-off Postgres → Clerk (real key only): `npm run db:sync:clerk` or `npm run db:sync:clerk:dry` from `apps/`.
- One-off Clerk → Postgres backfill (real key only): `npm run db:backfill:clerk -- --email <addr> | --clerk-id <user_…> | --all`. **Writes require `--yes`**; without it the script dry-runs and prints the target database host. Use for Clerk accounts created before the webhook existed. Optional `--role <client|chef|admin>`; existing rows keep their role unless it is passed.

> ⚠️ **Env precedence:** `loadRepoEnv()` lets repo-root `.env.local` **override shell-exported variables**. Exporting `SUPABASE_DB_URL` or `CLERK_SECRET_KEY` on a command line does **not** redirect these scripts — they will use `.env` / `.env.local` and can reach hosted Postgres when you believe you are on localhost. Check the `Database :` line the script prints before writing.
- Admin user provisioning (real key only): `POST /admin/users`, `PATCH /admin/users/:id/role` — see integration contract. Returns `503` with `sk_test_placeholder`.
- First admin: promote via SQL/Prisma Studio (`UPDATE users SET role = 'admin' WHERE email = '…'`); no self-serve promotion endpoint.

### Payments (Stripe)

Contract and rationale: [`docs/payments/stripe-payments-contract.md`](docs/payments/stripe-payments-contract.md).
Change register: [`docs/evolution/payments-stripe-cb-evolution.md`](docs/evolution/payments-stripe-cb-evolution.md).

- Modules: `modules/payments/` (`PaymentsModule`) + `modules/stripe-webhooks/` (`StripeWebhooksModule`).
- A card payment is a **Stripe Connect destination charge**: the platform keeps the commission as
  `application_fee_amount`, the chef's connected account gets the rest. A booking becomes
  `confirmed` when its **settled** payments cover it — a booking can be part CESU, part card.
- Client: `POST /payments/intent` → `{ clientSecret, … }`, confirmed with Stripe.js on the frontend.
  It charges **what is left to pay**, not the booking total. Requires a `pending` booking owned by
  the caller **and** a chef with `chargesEnabled` + `payoutsEnabled`, otherwise `409`.
- **Prefinanced CESU** (`POST /payments/cesu`): the funds never transit through the platform. The
  client pays from their issuer's beneficiary area (Pluxee, Edenred, UP, BIMPLI, Domiserve) using
  the chef's CRCESU number (NAN), so nothing is programmatically verifiable and the **chef**
  confirms (`POST /me/chef/cesu-payments/:id/confirm`), with a traced admin force-settle.
  The NAN is published on `GET /chefs/:id/cesu-info` (public), the booking detail and each quote —
  a client needs it *before* paying. `GET /me/bookings/:id/payment-status` gives the remaining
  amount; a CESU declaration may never exceed it (CRCESU forbids any surcharge).
- Chef: `POST/GET /me/chef-profile/stripe-connect/{link,status}` (Express onboarding — links are
  single-use, never cache them), `POST/GET /me/chef-profile/sepa-mandate*` (**records a mandate,
  never debits**), `GET/PATCH /me/chef-profile/sap` (NOVA vs cooperative declaration).
- **Commission on a CESU payment** cannot be withheld at charge time, so it is invoiced as
  **facture B** (`commission_invoices`, `LF-COM-<year>-NNNN`) and collected by **SEPA Direct Debit**.
  The invoice always precedes the debit — it is the legal basis it collects against — and a failed
  debit adds an attempt without cancelling the receivable. Stripe supports the **CORE** scheme only
  (not B2B), so a debit stays revocable for 8 weeks; a chef whose commission cannot be collected
  stops receiving bookings and payments. Admin: `GET /admin/commission-invoices`,
  `POST …/:id/retry-debit`, `POST …/run-due` (the `monthly_batch` trigger — **there is no cron**).
  Never send `on_behalf_of` / `transfer_data` / `application_fee_amount` on a commission debit.
- Fiscal attestation totals: `GET /me/fiscal-attestations/:year`, `GET /admin/fiscal-attestations[/:clientId]`.
  JSON only — no PDF. `platformAttestedAmountCents` is the narrower figure LAB'S FOOD attests:
  it excludes type B providers and e-CESU payments (one predicate, `isPlatformAttestable`).
- Without `STRIPE_SECRET_KEY` every payment route answers `503`; the webhook also needs
  `STRIPE_WEBHOOK_SECRET`. Commission defaults: `PAYMENTS_COMMISSION_RATE_BPS=1500`,
  `PAYMENTS_COMMISSION_VAT_RATE_BPS=2000`, `PAYMENTS_COMMISSION_DEBIT_TRIGGER=on_payment`,
  `PAYMENTS_COMMISSION_DEBIT_MAX_ATTEMPTS=3`, `PAYMENTS_COMMISSION_INVOICE_PREFIX=LF-COM`.

Local webhook loop:

```bash
stripe listen --forward-to localhost:8000/webhooks/stripe   # prints the whsec_… secret
stripe trigger payment_intent.succeeded
```

Put the printed secret in repo-root `.env` as `STRIPE_WEBHOOK_SECRET` (mind the env-precedence
warning above — `.env.local` overrides shell exports). Signature verification runs against the
**raw** request bytes captured by the `preParsing` hook in `apps/src/main.ts`; any new
signature-verified webhook path must be added to `WEBHOOK_RAW_BODY_PATHS` in
`apps/src/auth/fastify-raw-body.ts`.

