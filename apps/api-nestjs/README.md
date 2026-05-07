# api-nestjs

Primary backend for Labs Food: **NestJS 11 + Fastify** REST API documented via
OpenAPI/Swagger, backed by PostgreSQL (TypeORM) and Redis (ioredis).

## Local development

```bash
# from the repo root, start the backing services
docker compose up -d postgres redis

cd apps/api-nestjs
npm install
cp ../../.env.example ../../.env   # if not done yet, fill values
export DATABASE_URL="postgresql://lf:lf@localhost:5432/lf_backend"
export REDIS_URL="redis://localhost:6379/0"
npm run migration:run
npm run start:dev
```

- Swagger UI:    http://localhost:8000/docs
- OpenAPI JSON:  http://localhost:8000/openapi.json
- Health:        http://localhost:8000/health
- Readiness:     http://localhost:8000/ready

## Run with Docker Compose

From the repo root:

```bash
docker compose up --build api
```

The `api` container runs TypeORM migrations on startup.

## Scripts

| Command | Purpose |
|---------|---------|
| `npm run build` | Compile to `dist/` via `@nestjs/cli` |
| `npm run start:dev` | Watch mode with hot reload |
| `npm run start:prod` | Run the compiled `dist/main.js` |
| `npm run lint` | ESLint + Prettier check |
| `npm test` | Jest unit tests |
| `npm run migration:run` | Apply pending TypeORM migrations |
| `npm run migration:revert` | Roll back the most recent migration |
| `npm run migration:generate -- src/database/migrations/<name>` | Generate a new migration from current entities |
