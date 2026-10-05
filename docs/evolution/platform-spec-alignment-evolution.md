# Evolution Register — Platform spec alignment (SPEC-BACKEND + SPEC-ADMIN)

## Purpose

Track the gap between [`SPEC-BACKEND.md`](../SPEC-BACKEND.md) / [`SPEC-ADMIN-DASHBOARD.md`](../SPEC-ADMIN-DASHBOARD.md) and the current LF-BackEnd codebase. Updated when docs or delivery status change. Frontend repos are out of scope for this register.

**Analysis date:** 2026-05-22 (from spec impact review in Cursor).

## Resolved decisions (do not re-litigate without ADR)

| Topic          | Decision                                                                                       | Code action                                                                                                                           |
| -------------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| ORM            | **Prisma** replaces TypeORM                                                                    | Dedicated migration branch; **no Prisma code in repo until that branch**                                                              |
| Auth           | **Clerk** (not spec email/password JWT)                                                        | Frontends use Clerk; API keeps `ClerkAuthGuard` + user upsert                                                                         |
| Booking naming | Keep **`bookings`** module/table                                                               | Spec “reservation” is logical only unless API aliases are added                                                                       |
| Chef role      | **`chef`** replaces **`provider`** in `user_role`                                              | E1 migrated enum + profile table naming, API aliases kept backward compatible                                                         |
| Calendar       | **Cronofy**                                                                                    | Wire to chef availability / booking scheduling                                                                                        |
| Messaging      | **Stream**                                                                                     | Wire to client↔chef threads alongside persisted thread metadata if needed                                                             |
| Object storage | **Cloudflare R2** for public media, **Supabase Storage** for private documents; AWS S3 dropped | No other AWS footprint (Railway + Supabase + Clerk); R2 has no egress fee for storefront images. `AWS_*` env and `config.aws` removed |

## Documentation alignment (this effort)

| File                                | Status | Notes                                                                      |
| ----------------------------------- | ------ | -------------------------------------------------------------------------- |
| `stack.md`                          | Done   | Backend-only; Prisma/Clerk/bookings/chef decisions; correct `apps/` paths  |
| `docs/architecture.md`              | Done   | Spec-driven target modules & routes; backend only                          |
| `AGENTS.md`                         | Done   | Points to specs + evolution register; interim TypeORM note                 |
| `README.md`                         | Done   | `apps/` layout; links to evolution register                                |
| `docs/SPEC-ADMIN-DASHBOARD.md`      | Done   | Fixed cross-ref to `SPEC-BACKEND.md` (was `SPEC-BACKEND-BATCH-COOKING.md`) |
| `docs/features/f19-concept-cms.md`  | Done   | Paths `apps/src/…` (was `apps/api-nestjs/…`)                               |
| `docs/testing/f19-concept-cms-*.md` | Done   | Commands use `cd apps`                                                     |
| `docs/database-connection.md`       | Done   | Notes Prisma as target ORM                                                 |

## Epic backlog

### E0 — Prisma adoption

| Item                                                | Status | Notes                                                                   |
| --------------------------------------------------- | ------ | ----------------------------------------------------------------------- |
| Introduce `prisma/schema.prisma` from spec entities | Done   | Phase 1 + `cms_pages` + full spec domain (`20250522130000_spec_domain`) |
| Replace `@nestjs/typeorm` with PrismaService        | Done   | `apps/src/prisma/`                                                      |
| Baseline migration `20250522120000_init`            | Done   | Equivalent to former TypeORM DDL                                        |
| Seed `prisma/seed.ts` (F19 concept)                 | Done   | `npm run db:seed`                                                       |
| Update Docker/AGENTS/docs                           | Done   | `db:migrate`, `db:seed`                                                 |
| Remove TypeORM entities/migrations                  | Done   | See `docs/database-connection.md` § baseline for existing DBs           |

### E1 — Role rename `provider` → `chef`

| Item                                         | Status | Notes                                                                                              |
| -------------------------------------------- | ------ | -------------------------------------------------------------------------------------------------- |
| Prisma enum / DB enum `chef`                 | Done   | Migration `20260524173000_provider_role_to_chef` renames enum value safely for Postgres            |
| Rename `provider_profiles` → `chef_profiles` | Done   | Table + FK/index rename migration; `provider_id` columns intentionally kept for flow compatibility |
| Update guards, tests, seeds                  | Done   | Runtime enums now expose `CHEF`; booking DTOs expose `chefId` alias                                |

### E2 — Bookings lifecycle (spec states)

| Item                                                                                        | Status | Notes                                            |
| ------------------------------------------------------------------------------------------- | ------ | ------------------------------------------------ |
| Extend `booking_status`: `shopping`, `cooking`, `delivered`                                 | Todo   | Map away from `completed` if needed              |
| Reference generator `LF-YYYY-NNNN`                                                          | Todo   |                                                  |
| Fields: `formuleId`, `chefId`, `persons`, `amountTTC`, `amountAfterTax`, `shoppingByClient` | Todo   |                                                  |
| `booking_meals` junction                                                                    | Todo   |                                                  |
| `POST /bookings` create + Stripe                                                            | Todo   | Replace scaffold throw                           |
| Client: list, detail, cancel                                                                | Todo   | Prefer `/me/bookings`                            |
| Admin: list, detail, PATCH status, cancel                                                   | Todo   | `/admin/bookings` or `/admin/reservations` alias |
| Notifications on transitions                                                                | Todo   | Brevo + in-app                                   |

### E3 — Catalog (`catalog`)

| Item                                    | Status | Notes                                            |
| --------------------------------------- | ------ | ------------------------------------------------ |
| Entities: `Meal`, `MenuWeek`, `Formule` | Done   | Uses Prisma models from generated client         |
| `GET /menus/current` (public)           | Done   | Added in `catalog` module                        |
| Admin CRUD meals, menu-weeks, formules  | Done   | Added `GET/POST/PATCH` handlers under `/admin/*` |

### E4 — Client profile & CRM (`users`)

| Item                                            | Status | Notes                                                                                                                                                                                                                                                                                                                                                                             |
| ----------------------------------------------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ClientProfile` 1-1 `User`                      | Done   | Upsert flow wired via Clerk subject                                                                                                                                                                                                                                                                                                                                               |
| `GET/PATCH /me/profile`                         | Done   | Added authenticated profile endpoints                                                                                                                                                                                                                                                                                                                                             |
| Account, notifications, GDPR export/delete      | Todo   |                                                                                                                                                                                                                                                                                                                                                                                   |
| `GET/PATCH /admin/clients/:id`                  | Done   | Added with `AdminGuard` + optional status filter                                                                                                                                                                                                                                                                                                                                  |
| `GET /admin/clients` pagination                 | Done   | `page`/`limit` (default 20, max 100); returns `{ data, meta }` instead of a bare array — **breaking** for existing callers. Shared primitives in `apps/src/common/dto/pagination.dto.ts` for the other admin lists                                                                                                                                                                |
| `GET /admin/clients` lists every client account | Done   | Reads `users` with role `client` instead of `client_profiles`, which hid everyone who never saved preferences. Rows are `{ user, clientProfile }`, `clientProfile: null` until `PATCH /me/profile`; admins holding a client profile drop out — **breaking** for existing callers (admin-labsfood: `row.status` → `row.clientProfile?.status`, `row.id` → `row.clientProfile?.id`) |

### E5 — Quotes (`quotes`)

| Item                       | Status | Notes                                                          |
| -------------------------- | ------ | -------------------------------------------------------------- |
| `Quote` entity + lifecycle | Done   | `DEM-YYYY-NNNN` reference generator + status transitions       |
| Client submit/list/accept  | Done   | `POST /quotes`, `GET /me/quotes`, `POST /me/quotes/:id/accept` |
| Admin quote + assign chef  | Done   | `GET /admin/quotes`, `PATCH /admin/quotes/:id`                 |

### E6 — Shopping lists (`shopping-lists`)

| Item                                      | Status | Notes                                                                    |
| ----------------------------------------- | ------ | ------------------------------------------------------------------------ |
| Generate from meal ingredients × portions | Done   | `ShoppingListsService.regenerateForBooking()` aggregation by aisle       |
| Expose on booking detail (client + admin) | Done   | Added `/me/bookings/:id` + `/admin/bookings/:id` and regenerate endpoint |

### E7 — Messaging (`messaging`)

| Item                                     | Status | Notes |
| ---------------------------------------- | ------ | ----- |
| `ChatThread` / `ChatMessage` persistence | Todo   |       |
| Stream channels + webhooks               | Todo   |       |
| `/me/thread`, `/admin/threads`           | Todo   |       |

### E8 — Payments (`payments`)

| Item                                 | Status | Notes |
| ------------------------------------ | ------ | ----- |
| `Payment` entity                     | Todo   |       |
| `POST /payments/intent`              | Todo   |       |
| `POST /webhooks/stripe`              | Todo   |       |
| Tax credit fields on booking/payment | Todo   |       |

### E9 — Notifications (`notifications`)

| Item                                     | Status | Notes |
| ---------------------------------------- | ------ | ----- |
| `Notification` entity + user preferences | Todo   |       |
| Brevo templates                          | Todo   |       |
| SMS provider (spec) — env + adapter      | Todo   |       |
| `GET /admin/dashboard/badges`            | Todo   |       |

### E10 — Stats (`stats`)

| Item                                 | Status | Notes                                       |
| ------------------------------------ | ------ | ------------------------------------------- |
| `GET /me/dashboard`, `GET /me/stats` | Done   | Added in `stats` module                     |
| `GET /admin/dashboard` aggregations  | Done   | Revenue, sessions, formule split, top meals |

### E11 — Main site / admin-only domains

| Item                                 | Status | Notes                                                                |
| ------------------------------------ | ------ | -------------------------------------------------------------------- |
| Kossam orders                        | Todo   |                                                                      |
| Chef applications + secure documents | Todo   | Supabase Storage private bucket (`SUPABASE_KYC_BUCKET`), signed URLs |
| Contact messages + reply             | Todo   |                                                                      |
| Reviews moderation                   | Todo   |                                                                      |
| Team & service zones                 | Todo   |                                                                      |
| `AdminSettings` singleton            | Todo   |                                                                      |

### E12 — Infrastructure

| Item                    | Status | Notes                                                                              |
| ----------------------- | ------ | ---------------------------------------------------------------------------------- |
| Enable Redis module     | Todo   | Queues for notifications                                                           |
| Upload APIs             | Todo   | Dish photos on R2 (`R2StorageService`, FLOW-02); KYC documents on Supabase Storage |
| Clerk JWKS verification | Todo   | Phase 2 hardening                                                                  |

## Implemented today (baseline)

| Area         | Routes / artifacts                                                             |
| ------------ | ------------------------------------------------------------------------------ |
| Health       | `GET /health`, `GET /ready`                                                    |
| Users        | `GET /thisUser`, `GET /me`, `POST /admin/users`, `PATCH /admin/users/:id/role` |
| Bookings     | `GET /bookings`, `POST /bookings` (stub)                                       |
| Auth         | `ClerkAuthGuard`, `AdminGuard`                                                 |
| Integrations | Stripe, Cronofy, Stream, Brevo, Supabase scaffolds                             |

## Module → spec traceability

| Spec module (SPEC-BACKEND §2.2) | NestJS module (target)                    | Status                                                |
| ------------------------------- | ----------------------------------------- | ----------------------------------------------------- |
| auth                            | Clerk + users upsert + admin provisioning | Partial                                               |
| users                           | `users` + profile                         | Partial                                               |
| catalog                         | `catalog`                                 | Not started                                           |
| reservations                    | **`bookings`**                            | Scaffold                                              |
| quotes                          | `quotes`                                  | Not started                                           |
| shopping-lists                  | `shopping-lists`                          | Not started                                           |
| messaging                       | `messaging` + Stream                      | Not started                                           |
| payments                        | `payments`                                | Not started                                           |
| kossam                          | `kossam`                                  | Not started                                           |
| recruitment                     | `recruitment`                             | Not started                                           |
| contact                         | `contact`                                 | Not started                                           |
| reviews                         | `reviews`                                 | Not started                                           |
| notifications                   | `notifications`                           | Not started                                           |
| stats                           | `stats`                                   | Not started                                           |
| —                               | `content-cms`                             | **Removed** 2026-09-23 (added by mistake; never used) |
| admin (SPEC-ADMIN)              | `admin/*` controllers                     | Not started                                           |

## Admin API checklist (all Todo)

`GET /admin/dashboard`, `GET /admin/dashboard/badges`, bookings CRUD/patch, quotes, threads, clients, meals, menu-weeks, formules, kossam-orders, applications (+ document download), contact-messages, reviews, team, zones, settings.

## Client API checklist (Todo except noted)

`GET /me/dashboard`, `/me/bookings`, booking detail/cancel, `/menus/current`, quotes, `/me/thread`, `/me/profile`, `/me/stats`, `/payments/intent`, `/webhooks/stripe`, account/settings/GDPR — plus **Done:** `GET /me`, `GET /thisUser`.

## Intentionally out of scope (spec vs stack)

| Spec item                                 | Backend choice                                                                                        |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `POST /auth/login`, `/refresh`, `/logout` | Clerk owns sign-in and session lifecycle on the Next.js frontend; no password login routes on the API |
| Prisma in spec as illustration only       | Adopted as real ORM target                                                                            |
| Route prefix `/me/reservations`           | Use `/me/bookings` unless versioning adds alias                                                       |

> **Reversed 2026-08-03:** `POST /auth/register` was previously listed here as out of scope.
> It is now **implemented** — see the two-step sign-up flow below. Sign-**in** remains
> frontend-only; only registration moved to the API.

## Two-step sign-up (delivered 2026-08-03)

| Step            | Surface                                                  | Guard                | Effect                                                                                        |
| --------------- | -------------------------------------------------------- | -------------------- | --------------------------------------------------------------------------------------------- |
| Form 1          | `POST /auth/register`                                    | **none** (throttled) | Clerk BAPI user + `users` row, `role: client`; returns a single-use sign-in ticket            |
| —               | frontend `signIn.create({ strategy: 'ticket', ticket })` | —                    | Activates the Clerk session; no manual sign-in screen                                         |
| Form 2 (client) | `PATCH /me/profile`                                      | `ClerkAuthGuard`     | Upserts `client_profiles` + user identity fields                                              |
| Form 2 (chef)   | `PATCH /me/chef-profile`                                 | `ClerkAuthGuard`     | Upserts `chef_profiles`, promotes `users.role = chef`, always `is_active/is_verified = false` |
| Vetting         | `PATCH /admin/chefs/:id/verification`                    | `AdminGuard`         | Only path that may set `is_active` / `is_verified`                                            |

**Role assignment rule:** the _route_ selects the role; the request body never carries one.
`role` is absent from every DTO on this path, so `forbidNonWhitelisted` turns a submitted
`role` into a `400`. `admin` has no public surface and is set by SQL or by an existing admin.

### Known follow-ups

| Item                                                      | Status                                                                                                                                                |
| --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `is_active` / `is_verified` are **not read anywhere yet** | Chef listings, booking assignment, and any future `ChefGuard` **must** filter on both, or unvetted self-registered chefs leak into live booking flows |
| Switching profile type (client ↔ chef) after onboarding   | Blocked with `409` for now; needs reconciliation of the orphaned profile, bookings, and payouts. Planned as separate work                             |
| Email verification                                        | Off — BAPI auto-verifies. Nothing proves address ownership, so transactional mail will bounce on typo'd addresses. Revisit before payments go live    |

## Change log

| Date       | Change                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Reason                                                                                                                                              |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-05-22 | Created register; aligned stack, architecture, README, AGENTS, F19 doc paths                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | User request to document spec gap and decisions                                                                                                     |
| 2026-05-22 | Recorded Prisma, Clerk, bookings, chef (deferred), Cronofy, Stream decisions                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Team resolution on spec tensions                                                                                                                    |
| 2026-05-22 | **E0 done:** Prisma schema, migration, PrismaService, removed TypeORM                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | User-requested ORM switch                                                                                                                           |
| 2026-05-22 | Spec domain models + migration; seed JSON fix via `toInputJson`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Phase 1 + cms_pages todo cleared                                                                                                                    |
| 2026-05-22 | Prisma **7.6.0** + `prisma.config.ts`; `@prisma/adapter-pg`; generated client path                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | Replaces deprecated `package.json#prisma` + v6 client                                                                                               |
| 2026-05-24 | E1 delivered: enum rename + `chef_profiles` migration; kept `provider_id` DB columns for compatibility, added API `chefId` alias                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | Avoid breaking existing booking flow while aligning role terminology                                                                                |
| 2026-05-24 | E3/E4/E5/E6/E10 endpoints added (`catalog`, users profile/CRM, quotes, shopping lists, stats)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Phase 1 spec-alignment backend surface implemented                                                                                                  |
| 2026-07-05 | Admin user provisioning: `POST /admin/users`, `PATCH /admin/users/:id/role`; clerk-integration-contract                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Backend-only scope; no FAPI auth BFF                                                                                                                |
| 2026-08-03 | **Reversed** the `POST /auth/register` out-of-scope decision; delivered public registration + two-step onboarding (`PATCH /me/profile`, `PATCH /me/chef-profile`, `PATCH /admin/chefs/:id/verification`); added `@nestjs/throttler`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Product needs self-serve sign-up before booking; API owns registration while Clerk keeps sign-in                                                    |
| 2026-09-23 | **Removed the F19 concept CMS**: `content-cms` module, `GET`/`PUT /content/concept`, `CmsPage` and `cms_pages` (migration `20260923120000_remove_cms_pages`), `prisma/seed.ts` and `npm run db:seed`, `SUPABASE_CMS_ASSETS_BUCKET`, F19 docs                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Added by mistake at the start of the project; no frontend read it and the table held only seed rows                                                 |
| 2026-10-03 | **Batch cooker profile photo** on Cloudflare R2: `chef_profiles.avatar_url` (migration `20261003120000_chef_profile_avatar`), `POST /me/chef-profile/photo/upload-url` and `/confirm`, `DELETE /me/chef-profile/photo`, and the audited admin takedown `DELETE /admin/chefs/:id/photo`. `avatarUrl` now appears on every chef-profile payload, `PATCH /admin/chefs/:id/verification` included — an added field, **not breaking** for admin-labsfood. The public chef card fills its `avatarUrl`. `R2StorageService` moved to `integrations/` so users and dishes share it                                                                                                                                                                                                                                               | Profile picture served from Cloudflare; a candidate may set theirs before approval (user decision)                                                  |
| 2026-10-05 | **Photos by role:** the profile photo moves to the account (`users.avatar_url`; migration `20261005120000_avatar_on_account_menu_photo` copies chef photos and drops `chef_profiles.avatar_url`), for clients, batch cookers and admins: `POST /me/avatar/upload-url` and `/confirm`, `DELETE /me/avatar`, admin takedown `DELETE /admin/users/:id/avatar`. **Replaces** `/me/chef-profile/photo*` and `DELETE /admin/chefs/:id/photo` from 2026-10-03 — breaking for any caller already wired to them; `avatarUrl` leaves the chef-profile payloads and appears on every user payload (`GET /me`, `/admin/clients` rows), an added field there. Menus get photos (`menus.image_url`, `/me/menus/:id/photo*`), and admins illustrate Lab's Food dishes and menus (`/admin/meals/:id/photo*`, `/admin/menus/:id/photo*`) | Product decision: chefs photograph their avatar, dishes and menus; clients their avatar only; admins their avatar and Lab's Food's dishes and menus |
