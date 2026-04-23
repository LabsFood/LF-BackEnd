# api-nestjs

Secondary scaffold for Labs Food backend using **NestJS + Fastify adapter**.

This service is present for the long-term Node stack line per [`stack.md`](../../stack.md).
It is **not** started by the default Compose profile in Phase 1 — bring it up
explicitly with the `nest` Compose profile.

## Run locally (without Docker)

```bash
cd apps/api-nestjs
npm install
npm run start:dev
```

- Swagger UI at http://localhost:8001/docs
- Health at http://localhost:8001/health

## Run with Compose

From the repo root:

```bash
docker compose --profile nest up --build api-nestjs
```
