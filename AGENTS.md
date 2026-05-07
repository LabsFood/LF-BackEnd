# AGENTS.md

## Cursor Cloud specific instructions

### Services overview

| Service | Port | Purpose |
|---------|------|---------|
| FastAPI API (primary) | 8000 | REST API — booking, auth, integrations |
| PostgreSQL 16 | 5432 | Primary data store |
| Redis (with JSON module) | 6379 | Cache, queues, JSON document store |
| NestJS API (optional scaffold) | 8001 | Secondary Node.js API — Phase 1 scaffold only |

### Starting backing services

```bash
# Start Docker daemon (required first)
sudo dockerd &>/tmp/dockerd.log &

# Start PostgreSQL via docker compose
sudo docker compose up -d postgres

# Start Redis Stack (requires RedisJSON module — standard redis:7-alpine won't work)
sudo docker run -d --name redis-stack --network workspace_default -p 6379:6379 redis/redis-stack-server:latest
```

**Important:** The `redis_client.py` module executes `JSON.SET` at import time. You must use `redis/redis-stack-server` (not plain `redis:7-alpine`) or the FastAPI app will crash on startup.

### Running the FastAPI app (primary)

```bash
cd apps/api-fastapi
source .venv/bin/activate
export DATABASE_URL="postgresql+psycopg://lf:lf@localhost:5432/lf_backend"
export REDIS_URL="redis://localhost:6379/0"
export CLERK_SECRET_KEY="sk_test_placeholder"  # needed for auth routes to function
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

- Swagger UI: http://localhost:8000/docs
- Health: http://localhost:8000/health
- Readiness (checks PG + Redis): http://localhost:8000/ready

### Alembic migrations

The SQL init script in `infra/db/migrations/` runs automatically on first Postgres container start (via docker-entrypoint-initdb.d). On a fresh DB, stamp alembic rather than running `upgrade head` to avoid "DuplicateObject" errors:

```bash
cd apps/api-fastapi && source .venv/bin/activate
export DATABASE_URL="postgresql+psycopg://lf:lf@localhost:5432/lf_backend"
export REDIS_URL="redis://localhost:6379/0"
alembic stamp head
```

### Linting and testing

```bash
# Python lint (FastAPI)
cd apps/api-fastapi && source .venv/bin/activate && ruff check .

# Python tests (no test files exist yet, but pytest is configured)
cd apps/api-fastapi && source .venv/bin/activate && pytest

# NestJS (optional — has pre-existing TS type errors due to @nestjs/common@10 vs @nestjs/core@11 conflict)
cd apps/api-nestjs && npm run lint  # requires eslint config (not yet added)
cd apps/api-nestjs && npm run build  # will fail due to TS errors
```

### NestJS scaffold notes

The NestJS app (`apps/api-nestjs`) is a Phase 1 scaffold with known dependency version conflicts (`@nestjs/common@^10.3.10` vs `@nestjs/core@^11.1.19`). It won't compile until those are aligned. Use `--legacy-peer-deps` for `npm install`.

### Auth testing without Clerk

The auth middleware uses `jose.jwt.get_unverified_claims()`, so any well-formed JWT with a `sub` claim works locally when `CLERK_SECRET_KEY` is set to any non-empty string. Generate test tokens with:

```python
from jose import jwt
token = jwt.encode({"sub": "user_test_123", "email": "test@example.com"}, "any-secret", algorithm="HS256")
```
