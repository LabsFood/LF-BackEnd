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

- Webhook endpoint (public, Svix-verified): `POST /webhooks/clerk` — set `CLERK_WEBHOOK_SIGNING_SECRET` from Clerk Dashboard.
- One-off Postgres → Clerk (real key only): `npm run db:sync:clerk` or `npm run db:sync:clerk:dry` from `apps/`.
- Admin user provisioning (real key only): `POST /admin/users`, `PATCH /admin/users/:id/role` — see integration contract. Returns `503` with `sk_test_placeholder`.
- First admin: promote via SQL/Prisma Studio (`UPDATE users SET role = 'admin' WHERE email = '…'`); no self-serve promotion endpoint.

### F19 concept CMS

- Module: `modules/content-cms/` (`ContentCmsModule`)
- Routes: `GET` / `PUT` `/content/concept` (public read; admin write)
- General app content (non-CMS): `modules/content/` (`ContentModule`, reserved)
