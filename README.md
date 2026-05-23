# LF BackEnd

Monolithic backend for the Labs Food architecture: REST API (OpenAPI/Swagger) on **NestJS + Fastify**, Docker, and integrations fixed in [`stack.md`](./stack.md).

## Stack summary

| Layer                           | Choice                                                             |
| ------------------------------- | ------------------------------------------------------------------ |
| Runtime / application framework | Node.js 20, **NestJS 11** with **Fastify** adapter                 |
| REST API                        | NestJS controllers + `@nestjs/swagger` (OpenAPI/Swagger)           |
| ORM / migrations                | **Prisma** (target); interim **TypeORM** in `apps/` until migration branch |
| Database                        | PostgreSQL 16                                                      |
| Cache & queues                  | Redis 7 (availability/slots cache; async jobs: email, notifications) |
| Containers                      | Docker / Docker Compose                                            |
| Hosting                         | **Railway**                                                        |

## Third-party services

| Domain                              | Service                             |
| ----------------------------------- | ----------------------------------- |
| Auth (OAuth2 Google/Apple)          | [Clerk](https://clerk.com/)         |
| Calendar / chef availability        | [Cronofy](https://www.cronofy.com/) |
| Realtime chat (clients ↔ chefs)     | [Stream](https://getstream.io/)     |
| Transactional email                 | [Brevo](https://www.brevo.com/)     |
| Payments                            | [Stripe](https://stripe.com/)       |
| Maps & routing                      | Google Maps API                     |
| Object storage                      | AWS S3                              |

## Frontends (outside this repo)

- **Web:** Next.js, Tailwind CSS
- **Mobile:** React Native

## High-level flow

1. **Clients** — Next.js or React Native; sign-in via **Clerk**.
2. **API** — Bookings and profiles hit the NestJS backend; **PostgreSQL** holds users, profiles, providers, bookings, availability; **Redis** caches hot paths and backs async work.
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

```
apps/                  # NestJS + Fastify primary API (src/, package.json)
docs/
  SPEC-BACKEND.md      # product spec — client API & shared domain
  SPEC-ADMIN-DASHBOARD.md
  architecture.md      # backend architecture (spec-aligned)
  evolution/           # change registers (platform + F19)
docker-compose.yml     # postgres, redis, api
.env.example           # template for required environment variables
stack.md               # backend stack and decisions
```

## Getting started

### 1. Configure environment

```bash
cp .env.example .env
# fill in CLERK_SECRET_KEY, STRIPE_SECRET_KEY, … as needed
```

### 2. Run with Docker Compose (recommended)

```bash
docker compose up --build
```

- API:           http://localhost:8000
- Health:        http://localhost:8000/health
- Readiness:     http://localhost:8000/ready
- Swagger UI:    http://localhost:8000/docs
- OpenAPI JSON:  http://localhost:8000/openapi.json

The `api` container runs database migrations on startup (interim TypeORM), so the schema is created automatically against a fresh Postgres volume.

### 3. Run locally (without Docker)

```bash
# Start backing services only
docker compose up -d postgres redis

cd apps
npm install
npm run migration:run     # apply DB migrations (interim TypeORM)
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

- [`stack.md`](./stack.md) — backend stack, integrations, resolved decisions.
- [`docs/SPEC-BACKEND.md`](./docs/SPEC-BACKEND.md) — client API & domain spec.
- [`docs/SPEC-ADMIN-DASHBOARD.md`](./docs/SPEC-ADMIN-DASHBOARD.md) — admin API spec.
- [`docs/architecture.md`](./docs/architecture.md) — backend architecture (spec-aligned).
- [`docs/evolution/platform-spec-alignment-evolution.md`](./docs/evolution/platform-spec-alignment-evolution.md) — spec gap backlog & decisions.
- [`docs/features/f19-concept-cms.md`](./docs/features/f19-concept-cms.md) — F19 concept CMS analysis and implementation scope.
- [`docs/testing/f19-concept-cms-cahier-de-test.md`](./docs/testing/f19-concept-cms-cahier-de-test.md) — F19 test book and acceptance qualification cases.
- [`docs/testing/f19-concept-cms-test-execution.md`](./docs/testing/f19-concept-cms-test-execution.md) — F19 execution evidence and blocked/passed status.
- [`docs/evolution/f19-concept-cms-evolution.md`](./docs/evolution/f19-concept-cms-evolution.md) — F19 variables, functions, files, and route evolution register.
- [`AGENTS.md`](./AGENTS.md) — Cursor Cloud development instructions.
