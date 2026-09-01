# LF BackEnd

Monolithic backend for the Labs Food architecture: REST API (OpenAPI/Swagger) on **NestJS + Fastify**, Docker, and integrations fixed in `[stack.md](./stack.md)`.

> **Envie de lancer tout le projet LabsFood en local (les 4 repos, backend +
> les 3 apps front) en une commande ?** Voir **[LOCAL_SETUP.md](./LOCAL_SETUP.md)**.

## Stack summary


| Layer                           | Choice                                                               |
| ------------------------------- | -------------------------------------------------------------------- |
| Runtime / application framework | Node.js 20, **NestJS 11** with **Fastify** adapter                   |
| REST API                        | NestJS controllers + `@nestjs/swagger` (OpenAPI/Swagger)             |
| ORM / migrations                | **Prisma** (`apps/prisma/`)                                          |
| Database                        | PostgreSQL 16                                                        |
| Cache & queues                  | Redis 7 (availability/slots cache; async jobs: email, notifications) |
| Containers                      | Docker / Docker Compose                                              |
| Hosting                         | **Railway**                                                          |


## Third-party services


| Domain                          | Service                             |
| ------------------------------- | ----------------------------------- |
| Auth (OAuth2 Google/Apple)      | [Clerk](https://clerk.com/)         |
| Calendar / chef availability    | [Cronofy](https://www.cronofy.com/) |
| Realtime chat (clients ↔ chefs) | [Stream](https://getstream.io/)     |
| Transactional email             | [Brevo](https://www.brevo.com/)     |
| Payments                        | [Stripe](https://stripe.com/)       |
| Maps & routing                  | Google Maps API                     |
| Object storage                  | AWS S3                              |


## Frontends (outside this repo)

- **Web:** Next.js, Tailwind CSS
- **Mobile:** React Native

## High-level flow

1. **Clients** — Next.js or React Native; sign-in via **Clerk**.
2. **API** — Bookings and profiles hit the NestJS backend; **PostgreSQL** holds users, client profiles, chefs, bookings, and availability; **Redis** caches hot paths and backs async work.
3. **Integrations** — **Stripe**, **Cronofy**, **Brevo**, **Stream**, **Google Maps**, and **S3** are used from the backend as needed.
4. **Deploy** — Backend, PostgreSQL, and Redis run in **Docker** on **Railway**; frontends deploy on their own hosts (for example Vercel, Netlify, or Railway).

```mermaid
graph TD
    subgraph Frontend
        A([User])
        B[Next.js Web]
        C[React Native Mobile]
    end

    subgraph Auth_and_API["Auth & API"]
        D[Clerk Auth]
        E[NestJS REST API]
        F[Docker]
        G[Redis cache / queue]
        H[PostgreSQL]
    end

    subgraph External_Services["External Services"]
        I[Stripe]
        J[Cronofy Calendar]
        K[Brevo]
        L[Stream]
        M[Google Maps API]
        N[AWS S3 images]
    end

    subgraph Infra
        O[Railway]
    end

    A --> B
    A --> C
    B --> D
    C --> D
    D --> E
    E --> H
    E --> G
    E --> I
    E --> J
    E --> K
    E --> L
    E --> M
    E --> N
    G --> K
    G --> L
    G --> I
    H --> G
    F --> O
```

## Repository layout

``` bash
apps/                  # NestJS + Fastify primary API (src/, package.json)
docs/
  SPEC-BACKEND.md      # product spec — client API & shared domain
  SPEC-ADMIN-DASHBOARD.md
  architecture.md      # backend architecture (spec-aligned)
  payments/            # Stripe payment flow & webhook contract
  evolution/           # change registers (platform + payments)
docker-compose.yml     # postgres, api (local); Railway uses apps/Dockerfile
.env.example           # template for required environment variables
stack.md               # backend stack and decisions
```

## API endpoints

Use the **public Railway domain** for production (browser, Swagger, frontends, `curl` from your machine).  
Do **not** use `https://<service>.railway.internal` — that hostname is **private** (service-to-service inside Railway only).


| Endpoint                      | Local                                                                          | Production (public)                       |
| ----------------------------- | ------------------------------------------------------------------------------ | ----------------------------------------- |
| Base API                      | [http://localhost:8000](http://localhost:8000)                                 | `https://lf-api.labsfood.fr`      |
| Swagger UI                    | [http://localhost:8000/docs](http://localhost:8000/docs)                       | `https://lf-api.labsfood.fr/docs`            |
| OpenAPI JSON                  | [http://localhost:8000/openapi.json](http://localhost:8000/openapi.json)       | `https://lf-api.labsfood.fr/openapi.json`    |
| Health (liveness)             | [http://localhost:8000/health](http://localhost:8000/health)                   | `https://lf-api.labsfood.fr/health`          |
| Readiness (DB)                | [http://localhost:8000/ready](http://localhost:8000/ready)                     | `https://lf-api.labsfood.fr/ready`           |
| Concept CMS (public read) | [http://localhost:8000/content/concept](http://localhost:8000/content/concept) | `https://lf-api.labsfood.fr/content/concept` |
| Stripe webhook (signature-verified) | `http://localhost:8000/webhooks/stripe`                                        | `https://lf-api.labsfood.fr/webhooks/stripe` |


**Production `<custom-domain>`:** Railway → API service → **Settings** → **Networking** → **Generate domain** (or your custom domain). Example shape: `https://lf-backend-production-xxxx.up.railway.app`.

**Private (Railway only):** `http://lf-backend.railway.internal:<PORT>/…` — reachable from other services in the same Railway project, not from the public internet.

## Getting started

### 1. Configure environment

```bash
cp .env.example .env
# fill in CLERK_SECRET_KEY, STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, … as needed
```

Payments need `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET`; without them the
`/payments/*` routes answer `503`. The platform commission defaults to **15 % HT + 20 % VAT**
(`PAYMENTS_COMMISSION_RATE_BPS=1500`) — **a placeholder, not the negotiated rate**. See
[docs/payments/stripe-payments-contract.md](./docs/payments/stripe-payments-contract.md).

### 2. Run with Docker Compose (local)

Requires **Docker Compose v2** (`docker compose`, plugin bundled with Docker Desktop / recent Engine). If `docker compose up --build` fails with `unknown flag: --build`, use a two-step build or the legacy hyphenated CLI:

```bash
# Compose v2 (recommended)
docker compose build api
docker compose up api

# Or one shot when your CLI supports it:
docker compose up --build api

# Legacy docker-compose v1 (hyphenated binary)
docker-compose build api && docker-compose up api
```

Put `SUPABASE_DB_URL` (and optional `SUPABASE_DB_MIGRATION_URL`) in repo-root `.env` — for Compose Postgres use `postgresql://lf:lf@postgres:5432/lf_backend` as the host `**postgres**`, not `localhost`.

Local URLs: see [API endpoints](#api-endpoints) above.

The `api` container runs `**prisma migrate deploy**` on startup, then starts the API.

### 3. Production on Railway

See `**[docs/deploy/railway.md](./docs/deploy/railway.md)**` — link GitHub repo, set Supabase pooler + migration URLs, Clerk, CORS, health check `/health`. Config: `[railway.toml](./railway.toml)`, image `[apps/Dockerfile](./apps/Dockerfile)`.

After deploy, open Swagger at `**https://<public-domain>/docs**`. Smoke test:

```bash
export API_BASE="https://<custom-domain>"   # from Railway → Networking
curl -s "$API_BASE/health"
curl -s "$API_BASE/ready"
curl -s "$API_BASE/content/concept"
```

### 4. Run locally (without Docker API image)

```bash
# Start backing services only
docker compose up -d postgres

cd apps
npm install
export SUPABASE_DB_URL="postgresql://lf:lf@localhost:5432/lf_backend"
export SUPABASE_DB_MIGRATION_URL="${SUPABASE_DB_MIGRATION_URL:-$SUPABASE_DB_URL}"
export CLERK_SECRET_KEY="sk_test_placeholder"
npm run db:migrate
npm run start:dev         # watch mode on port 8000
```

## Tooling

```bash
cd apps
npm run build     # production tsc build to dist/
npm run lint      # eslint + prettier check
npm test          # jest unit tests
```

## Documentation

- `[stack.md](./stack.md)` — backend stack, integrations, resolved decisions.
- `[docs/SPEC-BACKEND.md](./docs/SPEC-BACKEND.md)` — client API & domain spec.
- `[docs/SPEC-ADMIN-DASHBOARD.md](./docs/SPEC-ADMIN-DASHBOARD.md)` — admin API spec.
- `[docs/architecture.md](./docs/architecture.md)` — backend architecture (spec-aligned).
- `[docs/evolution/platform-spec-alignment-evolution.md](./docs/evolution/platform-spec-alignment-evolution.md)` — spec gap backlog & decisions.
- `[docs/payments/stripe-payments-contract.md](./docs/payments/stripe-payments-contract.md)` — Stripe payment flow, Connect onboarding, commissions, webhook contract.
- `[docs/evolution/payments-stripe-cb-evolution.md](./docs/evolution/payments-stripe-cb-evolution.md)` — payments change register (files, routes, data model, tests).
- `[docs/features/f19-concept-cms.md](./docs/features/f19-concept-cms.md)` — F19 concept CMS analysis and implementation scope.
- `[docs/testing/f19-concept-cms-cahier-de-test.md](./docs/testing/f19-concept-cms-cahier-de-test.md)` — F19 test book and acceptance qualification cases.
- `[docs/testing/f19-concept-cms-test-execution.md](./docs/testing/f19-concept-cms-test-execution.md)` — F19 execution evidence and blocked/passed status.
- `[docs/evolution/f19-concept-cms-evolution.md](./docs/evolution/f19-concept-cms-evolution.md)` — F19 variables, functions, files, and route evolution register.
- `[docs/deploy/railway.md](./docs/deploy/railway.md)` — Railway production deploy checklist.
- `[docs/database-connection.md](./docs/database-connection.md)` — Supabase pooler vs direct URLs, Prisma migrations.
- `[AGENTS.md](./AGENTS.md)` — Cursor Cloud development instructions.

