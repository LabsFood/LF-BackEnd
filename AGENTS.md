# AGENTS.md

## Cursor Cloud specific instructions

### Application specifications

The product specs `docs/SPEC-BACKEND.md` and `docs/SPEC-ADMIN-DASHBOARD.md` and the gap register `docs/evolution/platform-spec-alignment-evolution.md` are **not in this repo**: commit `559c4d6` (2026-10-13) removed them. Read the last committed copy with `git show 559c4d6^:docs/SPEC-BACKEND.md` (same for the others). They give product intent; what is built is in Swagger (`/docs`) and this file. Stack and backend architecture: [`stack.md`](stack.md), [`docs/architecture.md`](docs/architecture.md).

### Services overview

| Service              | Port | Purpose                                                   |
| -------------------- | ---- | --------------------------------------------------------- |
| NestJS API (primary) | 8000 | REST API — booking, auth, integrations                    |
| PostgreSQL 16        | 5432 | Primary data store via Supabase Postgres URL (**Prisma**) |
| Redis 7              | 6379 | Messaging rate limit and realtime fan-out _(optional)_    |

### Starting backing services

```bash
# Start Docker daemon (required first)
sudo dockerd &>/tmp/dockerd.log &

# Bring up Postgres (Redis optional: messaging falls back to in-process)
sudo docker compose up -d postgres
# sudo docker compose up -d postgres redis
```

### Running the NestJS API (primary)

Either bring up the whole stack with Compose, or run the API locally against
the dockerised Postgres (Redis optional).

```bash
# Option A — full stack in Docker (Compose v2)
# If `docker compose up --build` errors with unknown flag --build, use:
#   docker compose build api && docker compose up api
sudo docker compose build api && sudo docker compose up api

# Option B — local dev with hot-reload (recommended while iterating)
# Put secrets in repo-root `.env` (optional `.env.local` overrides). No `apps/.env` needed.
cd apps
npm install
export SUPABASE_DB_URL="postgresql://lf:lf@localhost:5432/lf_backend"
# export REDIS_URL="redis://localhost:6379/0"   # optional, see Messaging below
export CLERK_SECRET_KEY="sk_test_placeholder"   # any non-empty string works locally
export SUPABASE_DB_MIGRATION_URL="${SUPABASE_DB_MIGRATION_URL:-$SUPABASE_DB_URL}"
npm run db:migrate       # apply Prisma migrations once (see docs/database-connection.md)
npm run start:dev        # listens on 8000
```

**Local**

- Swagger UI: http://localhost:8000/docs
- OpenAPI: http://localhost:8000/openapi.json
- Health: http://localhost:8000/health
- Readiness: http://localhost:8000/ready (pings Postgres)

**Production (Railway public domain)** — copy from Railway → service → **Networking**; do not use `*.railway.internal` in a browser:

- Swagger UI: `https://lf-api.labsfood.fr/docs`
- OpenAPI: `https://lf-api.labsfood.fr/openapi.json`
- Health: `https://lf-api.labsfood.fr/health`
- Readiness: `https://lf-api.labsfood.fr/ready`

### Database (Prisma)

```bash
cd apps
npm run db:migrate                    # apply pending migrations (deploy)
npm run db:resolve -- --applied <name>  # baseline: mark migration applied without DDL
npm run db:migrate:dev                # dev: create/apply migrations
npm run db:studio                     # Prisma Studio
```

Docker `api` runs `prisma migrate deploy` on container start (`apps/scripts/docker-entrypoint.sh`, `apps/Dockerfile`). Config: `apps/prisma.config.ts`. Schema: `apps/prisma/schema.prisma`.

### Railway production

Deploy checklist: [`docs/deploy/railway.md`](docs/deploy/railway.md). Config-as-code: [`railway.toml`](railway.toml). Set `SUPABASE_DB_URL` (transaction pooler :6543), `SUPABASE_DB_MIGRATION_URL` (session or direct :5432), `CLERK_SECRET_KEY`, `CORS_ORIGINS`, `NODE_ENV=production`. Health check path: `/health`. Public API base URL: Railway **Networking** domain (see README **API endpoints**).

### Linting and testing

```bash
cd apps
npm run lint        # eslint + prettier
npm run build       # tsc via @nestjs/cli, output to dist/
npm test            # jest unit tests
```

### Auth testing without Clerk

With `CLERK_SECRET_KEY=sk_test_placeholder`, `ClerkAuthGuard` decodes the JWT
payload without JWKS verification so any well-formed JWT with a `sub` claim works
locally. When a real `sk_test_…` / `sk_live_…` key is set, tokens are verified
via `@clerk/backend` (`verifyToken`). Generate a local stub token with Node:

```bash
node -e '
  const h = Buffer.from(JSON.stringify({alg:"HS256",typ:"JWT"})).toString("base64url");
  const p = Buffer.from(JSON.stringify({sub:"user_test_123",email:"test@example.com"})).toString("base64url");
  console.log(`${h}.${p}.signature`);
'
```

Use the token as `Authorization: Bearer <token>` against `/thisUser`, `/me`, or
`/me/bookings`.

### Clerk webhooks and DB sync

Architecture: [`docs/auth/clerk-supabase-sync.md`](docs/auth/clerk-supabase-sync.md). Frontend/backend boundary: [`docs/auth/clerk-integration-contract.md`](docs/auth/clerk-integration-contract.md).

- Public sign-up (no session): `POST /auth/register` — `email` + `password`, always `role: client`, IP rate-limited. Returns a 60s Clerk sign-in ticket the frontend redeems with `signIn.create({ strategy: 'ticket', ticket })`. Returns `503` with `sk_test_placeholder`.
- Onboarding form 2 (authenticated, clients): `PATCH /me/profile`. **The body never carries a role**; a submitted `role` is a `400`.
- Chef self-edit (authenticated, verified batch cookers only): `PATCH /me/chef-profile` updates `displayName`, `bio`, `city`, `serviceRadiusKm` and the shared identity fields. It **never creates a profile and never changes a role** — a client calling it gets a `404`, a candidate awaiting approval a `403 CHEF_NOT_VERIFIED`. `isActive`, `isVerified`, payout/calendar ids, SAP route and intervention zones are refused. Batch cooker accounts are created by submitting a candidature (see _Chef onboarding_ below).
- Webhook endpoint (public, Svix-verified): `POST /webhooks/clerk` — set `CLERK_WEBHOOK_SIGNING_SECRET` from Clerk Dashboard.
- One-off Postgres → Clerk (real key only): `npm run db:sync:clerk` or `npm run db:sync:clerk:dry` from `apps/`.
- One-off Clerk → Postgres backfill (real key only): `npm run db:backfill:clerk -- --email <addr> | --clerk-id <user_…> | --all`. **Writes require `--yes`**; without it the script dry-runs and prints the target database host. Use for Clerk accounts created before the webhook existed. Optional `--role <client|chef|admin>`; existing rows keep their role unless it is passed.

> ⚠️ **Env precedence:** `loadRepoEnv()` lets repo-root `.env.local` **override shell-exported variables**. Exporting `SUPABASE_DB_URL` or `CLERK_SECRET_KEY` on a command line does **not** redirect these scripts — they will use `.env` / `.env.local` and can reach hosted Postgres when you believe you are on localhost. Check the `Database :` line the script prints before writing.

- Admin user provisioning (real key only): `POST /admin/users`, `PATCH /admin/users/:id/role` — see integration contract. Returns `503` with `sk_test_placeholder`.
- First admin: promote via SQL/Prisma Studio (`UPDATE users SET role = 'admin' WHERE email = '…'`); no self-serve promotion endpoint.

### Payments (Stripe)

Contract and rationale: [`docs/payments/stripe-payments-contract.md`](docs/payments/stripe-payments-contract.md).
Change register: [`docs/evolution/payments-stripe-cb-evolution.md`](docs/evolution/payments-stripe-cb-evolution.md).

- Modules: `modules/payments/` (`PaymentsModule`) + `modules/stripe-webhooks/` (`StripeWebhooksModule`).
- A card payment is a **Stripe Connect destination charge**: the platform keeps the commission as
  `application_fee_amount`, the chef's connected account gets the rest. A payment is settled
  **only** by the webhook, never on the client's word.
- Client: `POST /payments/checkout-session` → a Stripe Checkout `url`, or `POST /payments/intent`
  → `{ clientSecret, … }` for Stripe.js. Both require a payable booking owned by the caller (see
  _Paying a prestation_ below) **and** a verified chef with `chargesEnabled` + `payoutsEnabled`,
  otherwise `409`.
- Chef: `POST/GET /me/chef-profile/stripe-connect/{link,status}` (Express onboarding — links are
  single-use, never cache them), `POST/GET /me/chef-profile/sepa-mandate*` (the mandate the CESU and
  immediate-advance commissions are debited against), `GET/PATCH /me/chef-profile/sap` (NOVA vs cooperative declaration).
- Fiscal attestation totals: `GET /me/fiscal-attestations/:year`, `GET /admin/fiscal-attestations[/:clientId]`.
  JSON only — no PDF.
- Without `STRIPE_SECRET_KEY` every payment route answers `503`; the webhook also needs
  `STRIPE_WEBHOOK_SECRET`, plus `STRIPE_CONNECT_WEBHOOK_SECRET` on deployed environments
  (`account.updated` comes from a second, "Connected accounts" Dashboard endpoint).
  Commission: the admin setting, falling back to `PAYMENTS_COMMISSION_RATE_BPS=1500` (15 % HT)
  and `PAYMENTS_COMMISSION_VAT_RATE_BPS=2000`.

Local webhook loop:

```bash
stripe listen --forward-to localhost:8000/webhooks/stripe   # prints the whsec_… secret
stripe trigger payment_intent.succeeded
```

Put the printed secret in repo-root `.env` as `STRIPE_WEBHOOK_SECRET` (mind the env-precedence
warning above — `.env.local` overrides shell exports). Signature verification runs against the
**raw** request bytes captured by the `preParsing` hook in `apps/src/main.ts`; any new
signature-verified webhook path must be added to `WEBHOOK_RAW_BODY_PATHS` in
`apps/src/auth/fastify-raw-body.ts`.

### Chef onboarding (FLOW-01)

Candidature (creates the account) → KYC documents → admin validation. Module:
`modules/chef-onboarding/`. Spec: [`FLOW-01-candidature-batch-cooker.md`](../batchcooking-web/docs/api/FLOW-01-candidature-batch-cooker.md) (in `batchcooking-web`),
PRD: `.claude/prds/batchcooker-chef-onboarding.prd.md` (not in the repo since `559c4d6`: `git show 559c4d6^:.claude/prds/batchcooker-chef-onboarding.prd.md`).

**Submitting a candidature creates the account**: a Clerk user with no password,
the `users` row (`role: chef`) and a chef profile with `isVerified` and
`isActive` false. The candidate is **browse-only** until approval — the
candidature and its documents are the only things they can act on, enforced in
the API (`PATCH /me/chef-profile` → `403 CHEF_NOT_VERIFIED`). **Not yet enforced
on the client-side routes** — `POST /me/bookings`, `POST /quotes` and
`POST /me/quotes/:id/offers/:offerId/accept` (and the deprecated
`POST /me/quotes/:id/accept`) accept any chef account, verified or not, refusing
only a booking or request addressed to the caller's own profile (`SAME_PERSON`);
the rest waits on the self-dealing guard (see the `ponytail:` note on
`assertNoConflictingProfile`). Approval sets
`isVerified` (and `isActive` if asked) and is refused with
`409 DOCUMENT_REQUIRED` unless every blocking document is `valid`. A refused
candidate keeps the account, sees the reason and the reapply date, and can
reapply from it.

| Actor                       | Routes                                                                                                                                                                                                             |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Public                      | `POST /chef-applications`, `GET /referentials/regions`                                                                                                                                                             |
| Signed-in candidate or chef | `GET\|PATCH /me/chef-application`, `POST /me/chef-application/reapply`, `GET /me/chef-documents`, `POST /me/chef-documents/:type/upload-url`, `.../confirm`, `GET /me/chef-documents/:type/versions`, `.../preview-url` |
| Admin                       | `GET /admin/chef-applications[/:id]`, `GET .../documents/:type/download-url`, `PATCH .../documents/:type`, `POST .../request-changes`, `.../approve`, `.../reject`, `POST /admin/chef-users/:id/resend-invitation` |

- **Public account creation**: the sign-in link (Clerk sign-in token, 7 days,
  single use) is emailed to the submitted address and **never returned in the
  response** — with no password on the account, the inbox is the only way in, so
  submitting someone else's address yields an account nobody can open. An address
  that already has an account is refused with `409 EMAIL_ALREADY_USED` and nothing
  is attached to it. `ThrottlerGuard`, 5 per hour per IP. If anything fails after
  the Clerk user exists, the Clerk user is deleted.
- **That email is load-bearing.** `BREVO_API_KEY` and
  `BREVO_TPL_APPLICATION_RECEIVED` are **required** wherever candidatures are
  accepted, and `BREVO_TPL_SIGN_IN_LINK` for the admin resend: without them the
  account is created but nobody can get into it. A lost email is recorded as a
  failed `application.sign_in_link_email` audit row against the candidature.
- **Verification only through approval**: `PATCH /admin/chefs/:id/verification`
  refuses `isVerified: true` for a profile whose candidature is not approved, and
  `isActive: true` for an unverified profile. Profiles older than FLOW-01 (no
  candidature) keep the manual path.
- **One profile per account** (`assertNoConflictingProfile`): an existing client
  cannot apply from their account. The client ↔ chef switcher is deferred — see
  the `ponytail:` note there.
- **Documents** live in one append-only `chef_documents` table owned by the chef
  profile from the first upload, so the candidature and the living dossier are
  the same rows and history cannot drift. `missing` is derived, never stored.
- **Storage**: private Supabase bucket (`SUPABASE_KYC_BUCKET`), signed PUT to
  upload and 5-minute signed GET to read. Files never transit the API. Supabase
  fixes the upload token at 2 h; that is not configurable.
- **Daily job** (`ChefDossierCron`, 06:00): expiry warnings at J-60/30/7 (verified
  chefs), expiry + automatic suspension at J+0, retention purge of the documents
  of unverified profiles refused 3 months ago or idle 6 months (the account and
  the candidature row stay). In-process and
  idempotent — two API replicas would both fire it harmlessly. See the
  `ponytail:` note in that file before adding a replica.
- **Suspension episode**: `chef_profiles.auto_suspended_at` marks an _open
  automatic-suspension episode_, not merely "offline". Depositing a replacement
  brings the storefront back immediately (§7 "réversible immédiatement") while
  leaving the column set, so `auto_suspended_at IS NOT NULL AND is_active`
  means _live on an unreviewed document_ — those dossiers sort first in the
  admin queue and carry `reactivatedPendingReview`. An admin validating the
  replacement clears the column; refusing it takes the chef back offline. A
  chef an admin deactivated has a null column and is never auto-reactivated.
- **Emails**: Brevo templates, ids in `BREVO_TPL_*`. An unset id is a logged
  no-op, so an email outage never rolls back an approval.

### Dishes, menus, publication and moderation (FLOW-02)

Batch cookers publish their own dishes and weekly menus; admins moderate after the
fact. Module: `modules/dishes/`. Spec:
[`FLOW-02-plats-et-menus.md`](../batchcooking-web/docs/api/FLOW-02-plats-et-menus.md) (in `batchcooking-web`), PRD:
`.claude/prds/chef-dishes-menus.prd.md` (not in the repo since `559c4d6`: `git show 559c4d6^:.claude/prds/chef-dishes-menus.prd.md`).

- **`meals` is the dish.** `chef_profile_id` is the owner (null: Lab's Food
  content), `created_by_user_id` the author, for attribution only. The legacy
  `/admin/meals` and `/admin/menu-weeks` routes touch Lab's Food rows only.
- **One access rule** (`ChefContentService`): another chef's dish or menu is 404
  on a read and `403 CONTENT_NOT_OWNED` on a write. Writes need an approved chef
  (`CHEF_NOT_VERIFIED`); publishing also needs a `validated` dossier.
- **The recipe is private**: `ingredients`, `steps`, `reheating`, `storage` never
  reach a public route or a client before the prestation (`RECIPE_FIELDS`).
- **Publication is direct, moderation after the fact.** Content waits in the
  review queue (`review_pending_since`) until an admin looks; a suspension needs
  a 15–500 character reason the chef reads as written.
- **Suggestions and offers**: an unowned, unoffered, published row is a
  suggestion every chef can adopt (a draft copy, audited as consent); an offer is
  visible to one chef, who takes the row over by accepting. Admins never set an
  owner.
- **Recipe versions**: `meals.recipe_version` goes up on every recipe change; a
  booking pins the version it cooks from (`booking_meals.recipe_version`) and the
  content is kept in `meal_recipe_versions`, so the fiche and the shopping list
  always agree. Recettes lot 3: pinned, with the dish's allergens of that
  moment (`booking_meals.allergens_snapshot`, `pinned_at`), in the same
  transaction that writes the menu (booking created, dishes changed, a
  conflicting dish replaced); a booking from before lot 3 is pinned on first use
  of the fiche or the shopping list.
- **Menu freeze (lot 3)**: from 72 h before the start the dishes no longer
  change (`409 MENU_FROZEN`, with `frozenSince`), computed from `startsAt`.
  The allergy-conflict replacement still goes through; an admin may still
  change them (`menuFrozenOverride` in the audit log); the chef's re-pin is
  refused, and checks the client's allergies again before the freeze.
- **« À manger avant » and conservation (lot 3)**: each dish's date is the
  prestation day plus the pinned recipe's fridge days, or the chef's
  (`booking_meals.eat_before`, every change kept in
  `booking_meal_date_changes`), until 24 h after the end. Past
  `/admin/settings/fridge-alert` days (4 by default) it alerts, never blocks.
  The client reads the conservation sheet (JSON and PDF) once `delivered`, and
  is told then (`conservation.ready`).
- **Photos** on Cloudflare R2 (`R2_*`), presigned like KYC documents; without R2
  the photo routes answer 503.

| Actor                             | Routes                                                                                                                                                                                                                                                                            |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Public                            | `GET /menus/week`, `GET /chefs/:id`, `GET /chefs/:id/showcase`, `GET /referentials/{allergens,diets,dish-categories}`                                                                                                                                                             |
| Chef                              | `/me/dishes[/:id][/publish\|unpublish\|photo/…]`, `/me/menus[/:id][/publish\|unpublish]`, `GET\|PUT /me/showcase/weeks`, `GET /me/suggestions`, `POST /me/suggestions/:id/adopt`, `GET /me/offers`, `POST /me/offers/:id/{accept,decline}`                                        |
| Chef, admin, the booking's client | `GET /chef-missions/:id/shopping-list`, `GET .../dishes/:dishId/recipe-sheet` (client: once done), `GET .../conservation[.pdf]` (client: once delivered); chef only: `PUT .../shopping-list`, `POST .../shopping-list/reset`, `POST .../recipes/repin`, `PUT .../dishes/:dishId/eat-before` |
| Client                            | `GET /me/culinary-map`                                                                                                                                                                                                                                                            |
| Admin                             | `GET /admin/dishes[?review=pending]`, `GET /admin/dishes/custom-values`, `POST /admin/{dishes,menus}/:id/review`, `PATCH /admin/{dishes,menus}/:id/moderation`, `GET /admin/chefs/:id/{dishes,menus}`, `/admin/menus` (Lab's Food), `POST\|DELETE /admin/{meals,menus}/:id/offer` |

### Messaging

Conversations between a client and a batch cooker, and between any user and the
Lab's Food team. In-house (Stream was dropped): module `modules/messaging/`.

- **Two kinds.** `chef_client`: exactly one per (client, chef profile) pair,
  whatever the number of bookings. `support`: one per user; admins hold no
  participant row and answer as a shared inbox.
- **One access rule**: a conversation the caller does not take part in is `404`,
  on a read as on a write. The same `/me/conversations` routes serve clients and
  batch cookers.
- **One writer**: `MessagingService.postMessage` is the only place a message is
  stored, for participants and admins alike.
- **Contact details are masked when served, not when stored.** `messages.body` is
  always what was written; a detected phone number or email is served as `•••••`
  to both participants and the conversation is flagged for admins, who read the
  original. Detection is a regex (`domain/contact-detector.ts`): deterrence, not a
  guarantee.
- **J-2**: masking is lifted, and the other person's phone shown, from 48 h before
  a _confirmed_ booking until it ends (`domain/messaging.rules.ts`). Nothing is
  stored: moving or cancelling the booking changes the answer.
- **Writable** while a booking between the two is pending or confirmed, and for 14
  days after a completed one; then `409 CONVERSATION_READ_ONLY`. Support threads
  are always open. Admins can write in a closed thread.
- **A `chef_client` conversation starts from a booking**: `POST /me/conversations`
  with a `bookingId`. Accepting an offer opens it too, through
  `MessagingService.ensurePair`.
- **Realtime**: listen-only WebSocket on `/ws`. First frame
  `{"event":"auth","data":{"token":"<Clerk token>"}}`, answered by
  `{"event":"ready"}`. No subscriptions: the server pushes each person their own
  conversations, and admins everything. Sockets are closed after an hour so the
  browser re-authenticates.
- **Redis is optional.** With `REDIS_URL`, the send rate limit (20 per minute per
  person) and the events are shared between instances. Without it both are
  in-process: fine for one instance, wrong for two.
- **Attachments**: private Supabase bucket `SUPABASE_MESSAGING_BUCKET`, signed PUT
  then `attachments: [{ uploadId, fileName }]` on the message, 5-minute signed GET
  to read. PDF, JPEG, PNG, WebP, 10 MB, 3 per message.
- **Unread counts** are stored (`conversation_participants.unread_count`,
  `conversations.admin_unread_count`) and moved by the send and read transactions.
- **Email**: `MessagingNotifierCron` (every 5 minutes) emails a participant whose
  messages stayed unread 10 minutes, once per burst (`BREVO_TPL_NEW_MESSAGE`).
  The email never quotes the message.
- **Audit**: an admin opening, writing in, or dismissing the flag of a
  `chef_client` conversation writes `conversation.read`, `.intervened`,
  `.flag_dismissed`.

| Actor                    | Routes                                                                                                                                                                              |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Client or batch cooker   | `GET\|POST /me/conversations`, `POST /me/conversations/support`, `GET .../unread-count`, `GET .../:id`, `GET\|POST .../:id/messages`, `POST .../:id/read`, `.../:id/attachments/…` |
| Admin                    | `GET /admin/conversations[?type=&filter=unread\|flagged]`, `GET .../counts`, `POST .../support`, `GET .../:id`, `GET\|POST .../:id/messages`, `POST .../:id/read`, `.../dismiss-flag` |

### Batch cookers in the back office (LF-0164)

`GET /admin/chefs`, `GET /admin/chefs/counts`, `GET /admin/chefs/:id`
(`modules/users/admin-chefs.*`). Read-only.

- **Built on `chef_profiles`, not on candidatures.** A profile created before the
  candidature flow, or by hand, has no candidature and is still listed. Accounts
  with `users.deleted_at` set are never listed.
- **`{id}` is `chefProfile.id`**, as for `/admin/chefs/:id/{dishes,menus,verification}`.
  Not the account id, not the candidature id.
- **One `state` per profile**, from `is_verified`, `is_active` and
  `auto_suspended_at`: `online`, `offline`, `suspended`, `pending`. `STATE_WHERE`
  is the single definition: the filter, the counts and the value on each row read
  it. `state=verified` is the first three together.
- **Zones** are read from the profile, and from the candidature while the profile
  has none (they are copied at approval). `region=` matches either.
- **The detail is deliberately thin**: the dossier and documents stay at
  `GET /admin/chef-applications/{application.id}`, the content at
  `/admin/chefs/:id/dishes` and `/menus`. No rating: there is no reviews module.
- **Quote assignment**: `PATCH /admin/quotes/:id` takes `assignedChefUserId` (a
  verified batch cooker's account id, `null` to unassign, else
  `422 CHEF_NOT_ASSIGNABLE`), and quotes come back with `assignedChef`.

### Custom requests and offers (BLK-10)

A client asks for a prestation that is not in the catalogue, a batch cooker
prices it, the client accepts: that creates the prestation. Module
`modules/quotes/` (`quotes.service` for the request, `quote-offers.service` for
the offers, `quote.views` for what each side reads, `domain/quote.rules` for the
pure rules).

- **The batch cooker prices, in net.** `POST /me/chef/quotes/:id/offers` takes
  `netCents`; the client price is derived (`priceOffer`): the commission is taken
  out of the client price, `client = net / (1 − rate)`. An offer stores its net,
  its rate and both client amounts, and is never recomputed. An admin can price
  in the batch cooker's name (`POST /admin/quotes/:id/offers`).
- **The commission is a setting**, not a constant: `platform_settings.commission_bps`
  (seeded at 1500), read through `PlatformSettingsService`, changed with
  `PATCH /admin/settings/commission` (0 to 5000, audited). The fronts read
  `GET /pricing-rules`. The tax credit (`TAX_CREDIT_BPS`, 50 %) is the law's, not ours.
- **One offer at a time**, history kept: `uq_quote_offers_one_active` allows a
  single `sent|viewed` offer per request (`409 OFFER_ALREADY_ACTIVE`). Opening the
  request as the client turns `sent` into `viewed`. An offer past `validUntil` is
  `expired` by a cron every 10 minutes, and on the spot if someone tries to accept it.
- **Statuses** (`QUOTE_STATUS_HELP`): `submitted` → `quoted` → `accepted`, with
  `declined` (the client refused, the batch cooker may offer again),
  `chef_declined` (the batch cooker said no: the request loses its batch cooker
  and the team is emailed to reassign), `cancelled` (withdrawn by the client).
  `quoted` and `accepted` cannot be set by hand.
- **Who the request is with** is `quotes.assigned_chef_user_id`: set from the
  `chefProfileId` the client chose (verified and active, else
  `422 CHEF_NOT_AVAILABLE`), or by an admin (`PATCH /admin/quotes/:id`).
  `GET /admin/quotes?filter=needs_chef` lists the ones with nobody.
- **Acceptance creates the booking**, in one transaction: a `confirmed` booking at
  the client price, on the offer's date and slot (`slotWindow`, Paris hours), on a
  hidden "Prestation sur-mesure" line of the batch cooker, reference `LF-SM-…`
  from the request's `DEM-…`. `quotes.booking_id` is unique: one request, one
  prestation. Then, best-effort, the two get a conversation and the recap email.
  **No payment is taken here**: it comes after the prestation (FLOW-03).
- **What a batch cooker sees**: the town and a short client name until the offer
  is accepted, the street and contact details after. A client never sees the net
  nor the rate. Why a batch cooker declined is for admins only.
- **Emails**, all best-effort: `BREVO_TPL_QUOTE_REQUEST_CHEF`,
  `BREVO_TPL_QUOTE_NEEDS_CHEF_ADMIN` (to `CONTACT_NOTIFICATION_EMAIL`),
  `BREVO_TPL_QUOTE_OFFER_CLIENT`, `BREVO_TPL_QUOTE_OFFER_DECLINED_CHEF`,
  `BREVO_TPL_BOOKING_CONFIRMED` (one template, client and batch cooker).

| Actor        | Routes                                                                                                                              |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| Signed in    | `GET /pricing-rules`                                                                                                                |
| Client       | `POST /quotes`, `GET /me/quotes`, `GET\|DELETE /me/quotes/:id`, `POST /me/quotes/:id/offers/:offerId/accept\|decline`               |
| Batch cooker | `GET /me/chef/quotes`, `GET …/:id`, `POST …/:id/offers`, `POST …/:id/offers/:offerId/withdraw`, `POST …/:id/decline`                |
| Admin        | `GET /admin/quotes[?status=&filter=needs_chef]`, `GET\|PATCH …/:id`, `POST …/:id/offers`, `GET\|PATCH /admin/settings/commission`   |

### Paying a prestation (FLOW-03)

Module `modules/payments/` (card, CESU, commission invoices, Stripe Connect, SEPA
mandate, ported from `feat/payment-cesu-prefinanced`) plus `booking-payments.*`
(payment options, URSSAF immediate advance) and `modules/stripe-webhooks/`.

- **A prestation is paid after it took place.** `payment-rules.ts` is the single
  rule: a `confirmed` booking is payable once `endsAt` has passed
  (`409 BOOKING_NOT_DUE` before), a `pending` one at once (paying confirms it), a
  `cancelled` one never. The booking status does not change when a confirmed
  prestation is paid: "paid" is read from its payments (`bookingCoverage`).
- **The screen asks one route**: `GET /me/bookings/:id/payment-options` gives the
  state (`not-due`, `due`, `processing`, `paid`, `failed`), the amounts and the
  methods this client can use with this batch cooker. A method the batch cooker
  does not take is left out; `dueNowCents` is computed here, never in the browser.
- **What a batch cooker takes is derived, not declared twice**: card when their
  Stripe account can be charged and paid out, CESU when `sap_profiles.accepts_cesu`
  and a `crcesu_nan`, immediate advance when
  `sap_profiles.urssaf_tiers_prestation_status = active`.
- **Card**: `POST /payments/checkout-session` returns a Stripe Checkout `url`. A
  destination charge: the batch cooker receives the amount less the commission,
  withheld by Stripe. The amount is recomputed (`409 AMOUNT_MISMATCH`), return URLs
  must be on our own sites, a second click gets the same page. The intent of a
  Checkout page is unknown when the row is written: it carries
  `metadata.paymentId` and `paymentOfIntent` attaches it on the first webhook.
  `POST /payments/intent` (Stripe.js) remains for an embedded form.
- **CESU**: the client declares (`POST /payments/cesu`), the batch cooker confirms
  receipt, and only then is that part paid. The rest goes by card.
- **Immediate advance**: `POST /bookings/:id/settle` charges nothing. The request
  goes to URSSAF through `UrssafGateway`, the one door to URSSAF, and the
  prestation is `processing` until the answer. Refused: the payment fails and the
  prestation is due again. It exists per client **and** batch cooker
  (`urssaf_links`).
- **URSSAF is simulated** (`URSSAF_GATEWAY`: `disabled` by default, `simulated`
  refused beside a live Stripe key: the test deployment runs with
  `ENVIRONMENT=production` too, so the environment name cannot be the guard). While simulated an admin answers in URSSAF's place, and
  each answer is audited. The live gateway replaces `UrssafGateway` and feeds
  `BookingPaymentsService.recordUrssafOutcome`; nothing else moves.
- **The commission of a prestation born from an offer is the offer's**
  (`commission-policy.ts`): client price less the batch cooker's net, VAT inside,
  pro rata on a partial payment. It is never recomputed from today's rate, or the
  batch cooker would not get the net they were shown. Other bookings take the
  admin's rate. On card Stripe withholds it; on CESU and immediate advance the
  money never crosses the platform, so it is invoiced and debited by SEPA.
- **An unpaid commission stops new work, not payments**: a batch cooker with an
  exhausted commission debit cannot send an offer or be booked
  (`409 COMMISSION_UNPAID`); a client can always pay a prestation already done.
- **A prestation is created two ways.** An accepted offer makes it `confirmed`,
  paid after it took place. `POST /me/bookings` (client), `POST /chef/bookings`
  (for a client the batch cooker already knows) and `POST /admin/bookings`
  (availability not checked, audited) make it `pending`, priced on the server:
  paying it confirms it, and unpaid it holds the slot 72 h before it is
  cancelled. See _Booking lifecycle_ in [`docs/architecture.md`](docs/architecture.md).

| Actor        | Routes                                                                                                                                             |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Public       | `GET /chefs/:chefProfileId/cesu-info`                                                                                                              |
| Client       | `GET /me/bookings/:id/payment-options`, `GET …/payment-status`, `POST /payments/checkout-session`, `POST /payments/intent`, `POST /payments/cesu`, `POST /bookings/:id/settle`, `GET\|POST /me/urssaf-links`, `GET /me/fiscal-attestations/:year` |
| Batch cooker | `GET /me/chef/cesu-payments`, `POST …/:id/confirm\|reject`, `GET /me/chef/commission-invoices`, `…/stripe-connect/*`, `…/sepa-mandate*`, `GET\|PATCH /me/chef-profile/sap` |
| Admin        | `GET /admin/urssaf-links`, `POST …/:id/decision`, `GET /admin/urssaf-payments`, `POST …/:id/outcome`, `/admin/cesu-payments*`, `/admin/commission-invoices*`, `/admin/fiscal-attestations*`, `PATCH /admin/chefs/:id/sap-external-status` |
| Stripe       | `POST /webhooks/stripe`                                                                                                                            |

### Contact forms

The contact forms of the public sites (`labsfood.fr`, `batchcooking.labsfood.fr`)
and the admin inbox they feed. Module `modules/contact/`. Senders have no account.

- **Stored first, emailed second.** `POST /contact-messages` writes the row, then
  tells the team (`CONTACT_NOTIFICATION_EMAIL`, template
  `BREVO_TPL_CONTACT_RECEIVED_ADMIN`) without waiting: an email outage never loses
  a message. That email's Reply-To is the visitor.
- **Public, so rate-limited twice** (`CONTACT_RATE_LIMIT`): 5 per hour per IP
  (`ThrottlerGuard`) and 5 per hour per email address (counted from the stored
  rows, `429 TOO_MANY_MESSAGES`). A filled `website` field (honeypot) is answered
  `201` like a person and not stored.
- **A reply is emailed before it is recorded.** `POST …/reply` sends
  `BREVO_TPL_CONTACT_REPLY`; if the email does not leave, nothing is stored and
  the answer is `503 EMAIL_NOT_SENT`. `replied` cannot be set by hand.
- **Shared inbox**: one status per message (`new`, `read`, `replied`, `archived`),
  the same for every admin.
- **Legacy table**: `20261011120000_contact_messages` renames the unused
  `contact_messages` table and `contact_message_status` enum from
  `20250522130000_spec_domain` to `*_legacy`. Renamed, not dropped.

| Actor  | Routes                                                                                                             |
| ------ | ------------------------------------------------------------------------------------------------------------------ |
| Public | `POST /contact-messages`                                                                                           |
| Admin  | `GET /admin/contact-messages[?status=]`, `GET …/counts`, `GET …/:id`, `PATCH …/:id`, `POST …/:id/reply`            |

### Logging and debugging

- `LOG_JSON=true` (default in production) makes both the Nest app logs and the
  Fastify access logs JSON lines, which Railway's log explorer can filter by
  field. `LOG_LEVEL` sets verbosity.
- Every response carries `x-request-id` (honouring an inbound one from the
  proxy). The same id is written to `audit_log.request_id`.
- `audit_log` is the compliance journal **and** the debugging trail: document
  reads, decisions, approvals, suspensions, and failures (`outcome = 'failed'`,
  error in `metadata`). Railway log retention is short and cannot be queried by
  candidature; this can:

```sql
SELECT created_at, actor_type, action, outcome, metadata
FROM audit_log WHERE subject_id = '<application uuid>' ORDER BY created_at;
```

### Legacy tables renamed aside

The `20260920120000_chef_onboarding` migration renames the unused
`chef_applications` / `application_documents` tables (and the old
`chef_application_status` enum) from `20250522130000_spec_domain` to
`*_legacy`. They were never in `schema.prisma` and no code reads them, but they
collided by name. **Renamed, not dropped** — drop them once production is
confirmed empty.

`20260922120000_chef_account_at_submission` follows it: the account now exists
from submission, so it drops the candidate token columns, `approved_user_id`
and `chef_documents.application_id`, and makes `chef_documents.chef_profile_id`
NOT NULL. That last step fails on purpose if a candidature-era document has no
chef profile, rather than deleting an identity document silently.
