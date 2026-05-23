# lf-api-nestjs

Primary backend for Labs Food: **NestJS 11 + Fastify** REST API documented via
OpenAPI/Swagger, backed by Supabase Postgres. **Target ORM:** Prisma; interim migrations use TypeORM under `src/supabase/`. Redis is scaffolded but not enabled yet.

Product specs: [`../docs/SPEC-BACKEND.md`](../docs/SPEC-BACKEND.md), [`../docs/SPEC-ADMIN-DASHBOARD.md`](../docs/SPEC-ADMIN-DASHBOARD.md). Backlog: [`../docs/evolution/platform-spec-alignment-evolution.md`](../docs/evolution/platform-spec-alignment-evolution.md).

## Local development

```bash
# from the repo root, start the backing services
docker compose up -d postgres

cd apps
npm install
cp ../../.env.example ../../.env   # if not done yet, fill values (see docs/database-connection.md)
export SUPABASE_DB_URL="postgresql://lf:lf@localhost:5432/lf_backend"
# export REDIS_URL="redis://localhost:6379/0"
npm run migration:run   # uses SUPABASE_DB_MIGRATION_URL when set, else SUPABASE_DB_URL
npm run start:dev
```

- Swagger UI:    http://localhost:8000/docs
- OpenAPI JSON:  http://localhost:8000/openapi.json
- Health:        http://localhost:8000/health
- Readiness:     http://localhost:8000/ready

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
| `npm run migration:generate -- src/supabase/migrations/<name>` | Generate a new migration from current entities |
