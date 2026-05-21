# AGENTS.md

## Cursor Cloud specific instructions

### Services overview

| Service | Port | Purpose |
|---------|------|---------|
| NestJS API (primary) | 8000 | REST API — booking, auth, integrations |
| PostgreSQL 16 | 5432 | Primary data store via Supabase Postgres URL (TypeORM migrations on API startup) |
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
# Option A — full stack in Docker
sudo docker compose up --build api

# Option B — local dev with hot-reload (recommended while iterating)
# Put secrets in repo-root `.env` (optional `.env.local` overrides). No `apps/.env` needed.
cd apps
npm install
export SUPABASE_DB_URL="postgresql://lf:lf@localhost:5432/lf_backend"
# export REDIS_URL="redis://localhost:6379/0"   # not required until Redis is enabled
export CLERK_SECRET_KEY="sk_test_placeholder"   # any non-empty string works locally
npm run migration:run    # apply DB migrations once (see docs/database-connection.md for Supabase pooler vs direct)
npm run start:dev        # listens on 8000
```

- Swagger UI:  http://localhost:8000/docs
- OpenAPI:     http://localhost:8000/openapi.json
- Health:      http://localhost:8000/health
- Readiness:   http://localhost:8000/ready (pings Postgres)

### TypeORM migrations

```bash
cd apps
npm run migration:run                 # apply pending migrations
npm run migration:revert              # roll back the most recent migration
npm run migration:generate -- src/supabase/migrations/<name>
```

When the API container starts it runs `migrationsRun: true`, so a fresh
Postgres volume is bootstrapped automatically; you only need the CLI for new
migrations or manual rollbacks.

### Linting and testing

```bash
cd apps
npm run lint        # eslint + prettier
npm run build       # tsc via @nestjs/cli, output to dist/
npm test            # jest unit tests
```

### Auth testing without Clerk

`ClerkAuthGuard` decodes the JWT payload without signature verification, so any
well-formed JWT with a `sub` claim works locally as long as `CLERK_SECRET_KEY`
is set to a non-empty value. Generate a token with Node:

```bash
node -e '
  const h = Buffer.from(JSON.stringify({alg:"HS256",typ:"JWT"})).toString("base64url");
  const p = Buffer.from(JSON.stringify({sub:"user_test_123",email:"test@example.com"})).toString("base64url");
  console.log(`${h}.${p}.signature`);
'
```

Use the token as `Authorization: Bearer <token>` against `/thisUser`, `/me`, or
`/bookings`.

### F19 concept CMS

- Module: `modules/content-cms/` (`ContentCmsModule`)
- Routes: `GET` / `PUT` `/content/concept` (public read; admin write)
- General app content (non-CMS): `modules/content/` (`ContentModule`, reserved)
