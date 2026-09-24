# Clerk identity + Supabase/Prisma app data

> **Frontend/backend boundary:** see `[clerk-integration-contract.md](./clerk-integration-contract.md)` — sign-in/sign-up stay on Next.js (`@clerk/nextjs`); this API verifies JWTs and manages Postgres RBAC only.

## Roles


| Layer                             | Responsibility                                                                                                     |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| **Clerk**                         | Sign-in, sessions, JWTs (`sub` = Clerk user id). No bookings, roles, or CRM fields.                                |
| **Postgres (`users` via Prisma)** | Single source of truth: `clerk_user_id`, `email`, `full_name`, `role`, profiles, bookings, quotes, etc. |


Frontends authenticate with Clerk and call this API with `Authorization: Bearer <session_jwt>`. The API never uses the Supabase JS client for `users`; it uses `SUPABASE_DB_URL` with Prisma (service connection). **RLS** on Supabase applies when a frontend talks to Postgres/Storage through Supabase directly—not on this API path.

## Sync directions

### 1. Clerk → Postgres (primary, ongoing)

**Clerk Dashboard → Webhooks** → `POST /webhooks/clerk` on this API.

- Subscribe to `user.created`, `user.updated`, `user.deleted`.
- Set **Signing secret** → `CLERK_WEBHOOK_SIGNING_SECRET` (Svix).
- Handler verifies with `@clerk/backend/webhooks` (`verifyWebhook`) and:
  - `user.created` / `user.updated` → `UsersService.upsertFromClerkUserJson`
  - `user.deleted` → `UsersService.deleteByClerkId`

Webhooks are **eventually consistent**; do not block sign-in on webhook delivery.

#### Backfill for accounts the webhook never saw

A Clerk account created **before** the webhook was configured — or one that has never hit `GET /me` — has no `users` row, and nothing will create one until that person next signs in. `npm run db:backfill:clerk` pulls them across:

```bash
cd apps
npm run db:backfill:clerk -- --email someone@example.com              # dry run
npm run db:backfill:clerk -- --email someone@example.com --yes        # write
npm run db:backfill:clerk -- --clerk-id user_2nGxK8abc123 --yes
npm run db:backfill:clerk -- --all --yes                              # every missing Clerk user
npm run db:backfill:clerk -- --email someone@example.com --role admin --yes
```

- **Writes require `--yes`.** Without it the script dry-runs and prints the target database host.
- `--role` defaults to `client` on create. Existing rows **keep their role** unless `--role` is passed, so a backfill cannot silently demote an admin.
- Clerk accounts with no email address are skipped (`users.email` is `NOT NULL`).
- If the email already exists on a row with a *different* `clerk_user_id`, the script reports a conflict and skips rather than failing on `uq_users_email`. Fix the row's `clerk_user_id` by hand, then re-run.
- Requires a real `CLERK_SECRET_KEY` for both dry run and write.

> ⚠️ **Env precedence:** `loadRepoEnv()` lets repo-root `.env.local` **override shell-exported variables**. Exporting `SUPABASE_DB_URL` or `CLERK_SECRET_KEY` on the command line does **not** redirect this script — it will use `.env` / `.env.local`. Always read the `Database :` line the script prints before passing `--yes`.

### 2. Postgres → Clerk (migration / demo, one-off)

There is **no** Clerk Dashboard action to “import Supabase users”. Options:


| Approach                             | When                                                                                                                                                                                           |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `**npm run db:sync:clerk`**          | DB rows with placeholder `clerk_user_id` (demo seed tag or non-`user_…` id). Creates or links Clerk users via Backend API and updates `users.clerk_user_id`. Requires real `CLERK_SECRET_KEY`. |
| **Clerk Dashboard → Users → Create** | Manual test accounts; match email to an existing row or let webhook/`GET /me` create the row.                                                                                                  |
| **Clerk Backend API**                | Scripts/automation same as `db:sync:clerk`.                                                                                                                                                    |


Dry-run (`npm run db:sync:clerk:dry`) uses the same real `CLERK_SECRET_KEY` and queries Clerk per email (create vs link existing) without writing to Postgres.

### 3. Request-time upsert (first sign-in)

`GET /me` (and other guarded routes) call `ensurePersistedFromClerk`: JWT `sub` identifies the user; when a real `CLERK_SECRET_KEY` is set the API also calls Clerk BAPI `users.getUser` to persist email, full name, and phone before returning. 

Ensures a complete row exists even before webhooks arrive. See `[clerk-integration-contract.md](./clerk-integration-contract.md)` for the required frontend `GET /me` call after sign-in.

## Dashboard / frontend contract

Each app (client, admin, chef):

1. Clerk provider + sign-in UI.
2. `fetch(apiUrl + '/me', { headers: { Authorization: 'Bearer ' + token } })` after session is active.
3. Use returned `id`, `role`, `email` for routing and feature flags—not Clerk metadata alone.

Admin/chef roles are set in Postgres (`users.role`); Clerk does not drive RBAC in this API beyond proving identity.

### Admin provisioning (Backend API)


| Method  | Path                    | Purpose                                                          |
| ------- | ----------------------- | ---------------------------------------------------------------- |
| `POST`  | `/admin/users`          | Create Clerk user (BAPI) + Postgres row with explicit role       |
| `PATCH` | `/admin/users/:id/role` | Update `users.role`; optional Clerk `publicMetadata.role` mirror |


Requires real `CLERK_SECRET_KEY` for create. BAPI auto-verifies email on admin create (documented in integration contract). First admin: manual DB promotion — no self-serve endpoint.

## Local vs production Clerk


| Mode       | `CLERK_SECRET_KEY`        | JWT on API                         | Webhooks                                        |
| ---------- | ------------------------- | ---------------------------------- | ----------------------------------------------- |
| Local stub | `sk_test_placeholder`     | Decode only (see AGENTS.md)        | Not verified against Clerk cloud                |
| Real Clerk | `sk_test_…` / `sk_live_…` | `verifyToken` via `@clerk/backend` | Point tunnel or deploy URL to `/webhooks/clerk` |


## Webhook setup (Clerk Dashboard)

1. **Configure → Webhooks → Add endpoint**
2. URL: `https://<api-host>/webhooks/clerk` (e.g. production `https://lf-api.labsfood.fr/webhooks/clerk`; local via ngrok/cloudflared to port 8000).
3. Events: `user.created`, `user.updated`, `user.deleted`.
4. Copy **Signing secret** → `CLERK_WEBHOOK_SIGNING_SECRET` (Railway + local `.env`).
5. Send test event; confirm 200 and row in `users`.

## Railway

See `[docs/deploy/railway.md](../deploy/railway.md)`: set `CLERK_WEBHOOK_SIGNING_SECRET` with `CLERK_SECRET_KEY` and public API domain.

## Code map


| Piece                  | Location                                     |
| ---------------------- | -------------------------------------------- |
| JWT guard              | `apps/src/auth/clerk-auth.guard.ts`          |
| Admin guard            | `apps/src/auth/admin.guard.ts`               |
| Clerk BAPI             | `apps/src/integrations/clerk.service.ts`     |
| Upsert + admin ops     | `apps/src/modules/users/users.service.ts`    |
| Admin routes           | `apps/src/modules/users/users.controller.ts` |
| Webhook module         | `apps/src/modules/clerk-webhooks/`           |
| DB → Clerk script      | `apps/prisma/sync-users-to-clerk.ts`         |
| Clerk → DB backfill    | `apps/prisma/sync-clerk-to-db.ts`            |
| Placeholder id helpers | `apps/src/auth/clerk-ids.ts`                 |
| Integration contract   | `docs/auth/clerk-integration-contract.md`    |


## Gaps (frontend / product)

- First admin bootstrap is manual DB promotion; subsequent roles via `PATCH /admin/users/:id/role`.
- Stream, Stripe, Cronofy identities are separate integrations.
- Optional: store `clerk_user_id` in `public_metadata` from sync script for Dashboard visibility (not required for API).

