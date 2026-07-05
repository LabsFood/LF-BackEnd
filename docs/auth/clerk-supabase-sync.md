# Clerk identity + Supabase/Prisma app data

## Roles

| Layer | Responsibility |
|-------|----------------|
| **Clerk** | Sign-in, sessions, JWTs (`sub` = Clerk user id). No bookings, roles, or CRM fields. |
| **Postgres (`users` via Prisma)** | Single source of truth: `clerk_user_id`, `email`, `full_name`, `role`, profiles, bookings, quotes, CMS audit, etc. |

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

### 2. Postgres → Clerk (migration / demo, one-off)

There is **no** Clerk Dashboard action to “import Supabase users”. Options:

| Approach | When |
|----------|------|
| **`npm run db:sync:clerk`** | DB rows with placeholder `clerk_user_id` (demo seed tag or non-`user_…` id). Creates or links Clerk users via Backend API and updates `users.clerk_user_id`. Requires real `CLERK_SECRET_KEY`. |
| **Clerk Dashboard → Users → Create** | Manual test accounts; match email to an existing row or let webhook/`GET /me` create the row. |
| **Clerk Backend API** | Scripts/automation same as `db:sync:clerk`. |

Dry-run (`npm run db:sync:clerk:dry`) uses the same real `CLERK_SECRET_KEY` and queries Clerk per email (create vs link existing) without writing to Postgres.

### 3. Request-time upsert (first sign-in)

`GET /me` (and other guarded routes) call `upsertFromClerk` with JWT `sub` (+ email when present). Ensures a row exists even before webhooks arrive.

## Dashboard / frontend contract

Each app (client, admin, chef):

1. Clerk provider + sign-in UI.
2. `fetch(apiUrl + '/me', { headers: { Authorization: 'Bearer ' + token } })` after session is active.
3. Use returned `id`, `role`, `email` for routing and feature flags—not Clerk metadata alone.

Admin/chef roles are set in Postgres (`users.role`); Clerk does not drive RBAC in this API beyond proving identity.

## Local vs production Clerk

| Mode | `CLERK_SECRET_KEY` | JWT on API | Webhooks |
|------|-------------------|------------|----------|
| Local stub | `sk_test_placeholder` | Decode only (see AGENTS.md) | Not verified against Clerk cloud |
| Real Clerk | `sk_test_…` / `sk_live_…` | `verifyToken` via `@clerk/backend` | Point tunnel or deploy URL to `/webhooks/clerk` |

## Webhook setup (Clerk Dashboard)

1. **Configure → Webhooks → Add endpoint**
2. URL: `https://<api-host>/webhooks/clerk` (e.g. production `https://lf-api.labsfood.fr/webhooks/clerk`; local via ngrok/cloudflared to port 8000).
3. Events: `user.created`, `user.updated`, `user.deleted`.
4. Copy **Signing secret** → `CLERK_WEBHOOK_SIGNING_SECRET` (Railway + local `.env`).
5. Send test event; confirm 200 and row in `users`.

## Railway

See [`docs/deploy/railway.md`](../deploy/railway.md): set `CLERK_WEBHOOK_SIGNING_SECRET` with `CLERK_SECRET_KEY` and public API domain.

## Code map

| Piece | Location |
|-------|----------|
| JWT guard | `apps/src/auth/clerk-auth.guard.ts` |
| Upsert | `apps/src/modules/users/users.service.ts` |
| Webhook module | `apps/src/modules/clerk-webhooks/` |
| DB → Clerk script | `apps/prisma/sync-users-to-clerk.ts` |
| Placeholder id helpers | `apps/src/auth/clerk-ids.ts` |

## Gaps (frontend / product)

- Role assignment (admin/chef) remains a DB/admin concern after Clerk account exists.
- Stream, Stripe, Cronofy identities are separate integrations.
- Optional: store `clerk_user_id` in `public_metadata` from sync script for Dashboard visibility (not required for API).
