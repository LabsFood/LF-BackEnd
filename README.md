# LF BackEnd

Monolithic backend for the Labs Food architecture: REST API (OpenAPI/Swagger) on **NestJS + Fastify**, Docker, and integrations fixed in [`stack.md`](./stack.md).

## Stack summary

| Layer                           | Choice                                                             |
| ------------------------------- | ------------------------------------------------------------------ |
| Runtime / application framework | Node.js 20, **NestJS 11** with **Fastify** adapter                 |
| REST API                        | NestJS controllers + `@nestjs/swagger` (OpenAPI/Swagger)           |
| ORM / migrations                | TypeORM with `pg`                                                  |
| Database                        | PostgreSQL 16                                                      |
| Cache & queues                  | Redis 7 (availability/slots cache; async jobs: email, notifications) |
| Containers                      | Docker / Docker Compose                                            |
| Hosting                         | **Railway**                                                        |

## Third-party services

| Domain                              | Service                             |
| ----------------------------------- | ----------------------------------- |
| Auth (OAuth2 Google/Apple)          | [Clerk](https://clerk.com/)         |
| Calendar / provider availability    | [Cronofy](https://www.cronofy.com/) |
| Realtime chat (clients ↔ providers) | [Stream](https://getstream.io/)     |
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
apps/
  api-nestjs/          # NestJS + Fastify primary API (REST + OpenAPI)
docs/
  architecture.md      # Phase 1 architecture notes (entities, modules, integrations)
docker-compose.yml     # postgres, redis, api
.env.example           # template for required environment variables
stack.md               # high-level stack and flow diagram
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

The `api` container runs TypeORM migrations on startup, so the schema is created automatically against a fresh Postgres volume.

### 3. Run locally (without Docker)

```bash
# Start backing services only
docker compose up -d postgres redis

# In apps/api-nestjs
cd apps/api-nestjs
npm install
npm run migration:run     # apply DB migrations
npm run start:dev         # watch mode on port 8000
```

## Tooling

```bash
cd apps/api-nestjs
npm run build     # production tsc build to dist/
npm run lint      # eslint + prettier check
npm test          # jest unit tests
```

## Documentation

- [`stack.md`](./stack.md) — architecture notes and Mermaid source diagram.
- [`docs/architecture.md`](./docs/architecture.md) — Phase 1 architecture.
- [`AGENTS.md`](./AGENTS.md) — Cursor Cloud development instructions.
