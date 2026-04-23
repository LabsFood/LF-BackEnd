# api-fastapi

Primary runnable API for Labs Food (FastAPI).

## Run locally (without Docker)

```bash
cd apps/api-fastapi
python -m venv .venv && source .venv/bin/activate
pip install -e .
cp ../../.env.example ../../.env   # fill values
export $(grep -v '^#' ../../.env | xargs)
alembic upgrade head
uvicorn app.main:app --reload
```

- Swagger UI at http://localhost:8000/docs
- Health at http://localhost:8000/health, readiness at /ready

## Run with Compose (recommended)

From the repo root:

```bash
docker compose up --build
```

This starts the API, PostgreSQL, and Redis. Run migrations once the DB is up:

```bash
docker compose exec api alembic upgrade head
```
