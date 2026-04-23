# Database migrations

Two layers:

- **`0001_init.sql`** — plain SQL baseline used by the PostgreSQL Compose
  container via `docker-entrypoint-initdb.d`. It runs once on a fresh volume
  so `docker compose up` yields a usable schema with zero extra commands.
- **`apps/api-fastapi/alembic/`** — Alembic revisions (source of truth going
  forward). The `0001_init` revision matches the SQL baseline and is what the
  API container applies on startup (`alembic upgrade head`).

Going forward, **add new changes through Alembic** and regenerate the SQL
baseline only if a clean-install path needs refreshing.
