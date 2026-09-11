# LF-BackEnd Bruno collection

Open this `bruno/` folder as a collection in Bruno, pick the **Local** environment.

## Auth setup — real Clerk tokens (`GetToken` folder)

Fill these secrets in the **Local** environment first:
- `clerkSecretKey` — `sk_test_…` from the Clerk Dashboard
- `adminClerkUserId` / `clientClerkUserId` / `chefClerkUserId` — the `user_…` ids of three
  test users in that Clerk instance

Then **Run Folder** on `GetToken`. It runs in pairs, per role:
1. `POST https://api.clerk.com/v1/sessions` with `{"user_id": …}` → saves `…SessionId`
2. `POST https://api.clerk.com/v1/sessions/{id}/tokens` with `expires_in_seconds: 3600`
   → saves the JWT into `adminToken` / `clerkToken` / `chefToken`

Notes:
- Scripts store results with `bru.setVar`, as runtime variables held in memory.
  Re-run `GetToken` after reloading the VS Code window. Don't use `bru.setEnvVar`:
  the VS Code extension (5.0.2) drops environment changes made by scripts.
- `POST /v1/sessions` is **test-only — it is rejected on production instances**. That is
  fine here, and it is what makes this headless: no browser sign-in needed.
- Session tokens default to a 60s lifetime, hence the explicit `expires_in_seconds`
  (allowed range 30 … 315360000).
- A session created this way carries **no `azp` claim**, so `ClerkAuthGuard`'s
  `authorizedParties` check is skipped. Reusing a session id created from a *browser*
  instead would inherit that browser's origin as `azp`, and this API rejects it with 401
  unless the origin is in the CORS allowlist (`apps/src/config/allowed-origins.ts`, or
  `CORS_ORIGINS`).

**Roles live in Postgres, not in the token.** `AdminGuard` looks up `users.role` by
`clerkUserId`, so each test user needs its row created and promoted once:
```sql
-- after calling GET /me with that user's token
UPDATE users SET role = 'admin' WHERE clerk_user_id = '<adminClerkUserId>';
UPDATE users SET role = 'chef'  WHERE clerk_user_id = '<chefClerkUserId>';
```

## Layout

`GetToken` mints the bearer tokens; the rest is one folder per module/use case, mirroring
the NestJS controllers: `auth`, `users`, `admin-users`, `catalog`, `bookings`,
`payments/*`, `quotes`, `stats`, `content-cms`, `health`.

A few `POST` requests (create booking, create meal, create quote) save the returned id
into runtime variables (`bookingId`, `mealId`, `quoteId`) via a post-response script,
so the next request in the same folder can reuse it without copy-pasting.

## Not included

`POST /webhooks/clerk` and `POST /webhooks/stripe` require a real Svix/Stripe signature
over the raw body — not something worth faking in a REST client. Use `stripe listen
--forward-to localhost:8000/webhooks/stripe` and the Clerk CLI/dashboard for those instead
(see `apps/AGENTS.md`).
