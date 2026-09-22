# AGENTS.md

## Cursor Cloud specific instructions

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
- Onboarding form 2 (authenticated, clients): `PATCH /me/profile`. **The body never carries a role**; a submitted `role` is a `400`.
- Chef self-edit (authenticated, verified batch cookers only): `PATCH /me/chef-profile` updates `displayName`, `bio`, `city`, `serviceRadiusKm` and the shared identity fields. It **never creates a profile and never changes a role** — a client calling it gets a `404`, a candidate awaiting approval a `403 CHEF_NOT_VERIFIED`. `isActive`, `isVerified`, payout/calendar ids, SAP route and intervention zones are refused. Batch cooker accounts are created by submitting a candidature (see *Chef onboarding* below).
- Webhook endpoint (public, Svix-verified): `POST /webhooks/clerk` — set `CLERK_WEBHOOK_SIGNING_SECRET` from Clerk Dashboard.
- One-off Postgres → Clerk (real key only): `npm run db:sync:clerk` or `npm run db:sync:clerk:dry` from `apps/`.
- One-off Clerk → Postgres backfill (real key only): `npm run db:backfill:clerk -- --email <addr> | --clerk-id <user_…> | --all`. **Writes require `--yes`**; without it the script dry-runs and prints the target database host. Use for Clerk accounts created before the webhook existed. Optional `--role <client|chef|admin>`; existing rows keep their role unless it is passed.

> ⚠️ **Env precedence:** `loadRepoEnv()` lets repo-root `.env.local` **override shell-exported variables**. Exporting `SUPABASE_DB_URL` or `CLERK_SECRET_KEY` on a command line does **not** redirect these scripts — they will use `.env` / `.env.local` and can reach hosted Postgres when you believe you are on localhost. Check the `Database :` line the script prints before writing.
- Admin user provisioning (real key only): `POST /admin/users`, `PATCH /admin/users/:id/role` — see integration contract. Returns `503` with `sk_test_placeholder`.
- First admin: promote via SQL/Prisma Studio (`UPDATE users SET role = 'admin' WHERE email = '…'`); no self-serve promotion endpoint.

### F19 concept CMS

- Module: `modules/content-cms/` (`ContentCmsModule`)
- Routes: `GET` / `PUT` `/content/concept` (public read; admin write)
- General app content (non-CMS): `modules/content/` (`ContentModule`, reserved)

### Chef onboarding (FLOW-01)

Candidature (creates the account) → KYC documents → admin validation. Module:
`modules/chef-onboarding/`. Spec: [`FLOW-01-candidature-batch-cooker.md`](../batchcooking-web/docs/api/FLOW-01-candidature-batch-cooker.md) (in `batchcooking-web`),
PRD: [`.claude/prds/batchcooker-chef-onboarding.prd.md`](.claude/prds/batchcooker-chef-onboarding.prd.md).

**Submitting a candidature creates the account**: a Clerk user with no password,
the `users` row (`role: chef`) and a chef profile with `isVerified` and
`isActive` false. The candidate is **browse-only** until approval — the
candidature and its documents are the only things they can act on, enforced in
the API (`PATCH /me/chef-profile` → `403 CHEF_NOT_VERIFIED`). **Not yet enforced
on the client-side routes** — `POST /bookings`, `POST /quotes` and
`POST /me/quotes/:id/accept` accept any chef account, verified or not; that waits
on the self-dealing guard (see the `ponytail:` note on
`assertNoConflictingProfile`). Approval sets
`isVerified` (and `isActive` if asked) and is refused with
`409 DOCUMENT_REQUIRED` unless every blocking document is `valid`. A refused
candidate keeps the account, sees the reason and the reapply date, and can
reapply from it.

| Actor | Routes |
|---|---|
| Public | `POST /chef-applications`, `GET /referentials/regions` |
| Signed-in candidate or chef | `GET /me/chef-application`, `POST /me/chef-application/reapply`, `GET /me/chef-documents`, `POST /me/chef-documents/:type/upload-url`, `.../confirm`, `GET /me/chef-documents/:type/versions` |
| Admin | `GET /admin/chef-applications[/:id]`, `GET .../documents/:type/download-url`, `PATCH .../documents/:type`, `POST .../request-changes`, `.../approve`, `.../reject`, `POST /admin/chef-users/:id/resend-invitation` |

- **Public account creation**: the sign-in link (Clerk sign-in token, 7 days,
  single use) is emailed to the submitted address and **never returned in the
  response** — with no password on the account, the inbox is the only way in, so
  submitting someone else's address yields an account nobody can open. An address
  that already has an account is refused with `409 EMAIL_ALREADY_USED` and nothing
  is attached to it. `ThrottlerGuard`, 5 per hour per IP. If anything fails after
  the Clerk user exists, the Clerk user is deleted.
- **That email is load-bearing.** `BREVO_API_KEY` and
  `BREVO_TPL_APPLICATION_RECEIVED` are **required** wherever candidatures are
  accepted, and `BREVO_TPL_SIGN_IN_LINK` for the admin resend: without them the
  account is created but nobody can get into it. A lost email is recorded as a
  failed `application.sign_in_link_email` audit row against the candidature.
- **Verification only through approval**: `PATCH /admin/chefs/:id/verification`
  refuses `isVerified: true` for a profile whose candidature is not approved, and
  `isActive: true` for an unverified profile. Profiles older than FLOW-01 (no
  candidature) keep the manual path.
- **One profile per account** (`assertNoConflictingProfile`): an existing client
  cannot apply from their account. The client ↔ chef switcher is deferred — see
  the `ponytail:` note there.
- **Documents** live in one append-only `chef_documents` table owned by the chef
  profile from the first upload, so the candidature and the living dossier are
  the same rows and history cannot drift. `missing` is derived, never stored.
- **Storage**: private Supabase bucket (`SUPABASE_KYC_BUCKET`), signed PUT to
  upload and 5-minute signed GET to read. Files never transit the API. Supabase
  fixes the upload token at 2 h; that is not configurable.
- **Daily job** (`ChefDossierCron`, 06:00): expiry warnings at J-60/30/7 (verified
  chefs), expiry + automatic suspension at J+0, retention purge of the documents
  of unverified profiles refused 3 months ago or idle 6 months (the account and
  the candidature row stay). In-process and
  idempotent — two API replicas would both fire it harmlessly. See the
  `ponytail:` note in that file before adding a replica.
- **Suspension episode**: `chef_profiles.auto_suspended_at` marks an *open
  automatic-suspension episode*, not merely "offline". Depositing a replacement
  brings the storefront back immediately (§7 "réversible immédiatement") while
  leaving the column set, so `auto_suspended_at IS NOT NULL AND is_active`
  means *live on an unreviewed document* — those dossiers sort first in the
  admin queue and carry `reactivatedPendingReview`. An admin validating the
  replacement clears the column; refusing it takes the chef back offline. A
  chef an admin deactivated has a null column and is never auto-reactivated.
- **Emails**: Brevo templates, ids in `BREVO_TPL_*`. An unset id is a logged
  no-op, so an email outage never rolls back an approval.

### Logging and debugging

- `LOG_JSON=true` (default in production) makes both the Nest app logs and the
  Fastify access logs JSON lines, which Railway's log explorer can filter by
  field. `LOG_LEVEL` sets verbosity.
- Every response carries `x-request-id` (honouring an inbound one from the
  proxy). The same id is written to `audit_log.request_id`.
- `audit_log` is the compliance journal **and** the debugging trail: document
  reads, decisions, approvals, suspensions, and failures (`outcome = 'failed'`,
  error in `metadata`). Railway log retention is short and cannot be queried by
  candidature; this can:

```sql
SELECT created_at, actor_type, action, outcome, metadata
FROM audit_log WHERE subject_id = '<application uuid>' ORDER BY created_at;
```

### Legacy tables renamed aside

The `20260920120000_chef_onboarding` migration renames the unused
`chef_applications` / `application_documents` tables (and the old
`chef_application_status` enum) from `20250522130000_spec_domain` to
`*_legacy`. They were never in `schema.prisma` and no code reads them, but they
collided by name. **Renamed, not dropped** — drop them once production is
confirmed empty.

`20260922120000_chef_account_at_submission` follows it: the account now exists
from submission, so it drops the candidate token columns, `approved_user_id`
and `chef_documents.application_id`, and makes `chef_documents.chef_profile_id`
NOT NULL. That last step fails on purpose if a candidature-era document has no
chef profile, rather than deleting an identity document silently.
