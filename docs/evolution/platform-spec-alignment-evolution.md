# Evolution Register — Platform spec alignment (SPEC-BACKEND + SPEC-ADMIN)

## Purpose

Track the gap between [`SPEC-BACKEND.md`](../SPEC-BACKEND.md) / [`SPEC-ADMIN-DASHBOARD.md`](../SPEC-ADMIN-DASHBOARD.md) and the current LF-BackEnd codebase. Updated when docs or delivery status change. Frontend repos are out of scope for this register.

**Analysis date:** 2026-05-22 (from spec impact review in Cursor).

## Resolved decisions (do not re-litigate without ADR)

| Topic | Decision | Code action |
|-------|----------|-------------|
| ORM | **Prisma** replaces TypeORM | Dedicated migration branch; **no Prisma code in repo until that branch** |
| Auth | **Clerk** (not spec email/password JWT) | Frontends use Clerk; API keeps `ClerkAuthGuard` + user upsert |
| Booking naming | Keep **`bookings`** module/table | Spec “reservation” is logical only unless API aliases are added |
| Chef role | **`chef`** replaces **`provider`** in `user_role` | **Dedicated branch later — do not change enums/files in other work** |
| Calendar | **Cronofy** | Wire to chef availability / booking scheduling |
| Messaging | **Stream** | Wire to client↔chef threads alongside persisted thread metadata if needed |

## Documentation alignment (this effort)

| File | Status | Notes |
|------|--------|-------|
| `stack.md` | Done | Backend-only; Prisma/Clerk/bookings/chef decisions; correct `apps/` paths |
| `docs/architecture.md` | Done | Spec-driven target modules & routes; backend only |
| `AGENTS.md` | Done | Points to specs + evolution register; interim TypeORM note |
| `README.md` | Done | `apps/` layout; links to evolution register |
| `docs/SPEC-ADMIN-DASHBOARD.md` | Done | Fixed cross-ref to `SPEC-BACKEND.md` (was `SPEC-BACKEND-BATCH-COOKING.md`) |
| `docs/features/f19-concept-cms.md` | Done | Paths `apps/src/…` (was `apps/api-nestjs/…`) |
| `docs/testing/f19-concept-cms-*.md` | Done | Commands use `cd apps` |
| `docs/database-connection.md` | Done | Notes Prisma as target ORM |

## Epic backlog

### E0 — Prisma adoption

| Item | Status | Notes |
|------|--------|-------|
| Introduce `prisma/schema.prisma` from spec entities | Done | Phase 1 + `cms_pages` + full spec domain (`20250522130000_spec_domain`) |
| Replace `@nestjs/typeorm` with PrismaService | Done | `apps/src/prisma/` |
| Baseline migration `20250522120000_init` | Done | Equivalent to former TypeORM DDL |
| Seed `prisma/seed.ts` (F19 concept) | Done | `npm run db:seed` |
| Update Docker/AGENTS/docs | Done | `db:migrate`, `db:seed` |
| Remove TypeORM entities/migrations | Done | See `docs/database-connection.md` § baseline for existing DBs |

### E1 — Role rename `provider` → `chef`

| Item | Status | Notes |
|------|--------|-------|
| Prisma enum / DB enum `chef` | Todo | **Separate branch only** |
| Rename `provider_profiles` → chef profile or merge into `TeamMember` | Todo | Design in architecture.md |
| Update guards, tests, seeds | Todo | |

### E2 — Bookings lifecycle (spec states)

| Item | Status | Notes |
|------|--------|-------|
| Extend `booking_status`: `shopping`, `cooking`, `delivered` | Todo | Map away from `completed` if needed |
| Reference generator `LF-YYYY-NNNN` | Todo | |
| Fields: `formuleId`, `chefId`, `persons`, `amountTTC`, `amountAfterTax`, `shoppingByClient` | Todo | |
| `booking_meals` junction | Todo | |
| `POST /bookings` create + Stripe | Todo | Replace scaffold throw |
| Client: list, detail, cancel | Todo | Prefer `/me/bookings` |
| Admin: list, detail, PATCH status, cancel | Todo | `/admin/bookings` or `/admin/reservations` alias |
| Notifications on transitions | Todo | Brevo + in-app |

### E3 — Catalog (`catalog`)

| Item | Status | Notes |
|------|--------|-------|
| Entities: `Meal`, `MenuWeek`, `Formule` | Todo | |
| `GET /menus/current` (public) | Todo | |
| Admin CRUD meals, menu-weeks, formules | Todo | |

### E4 — Client profile & CRM (`users`)

| Item | Status | Notes |
|------|--------|-------|
| `ClientProfile` 1-1 `User` | Todo | |
| `GET/PATCH /me/profile` | Todo | |
| Account, notifications, GDPR export/delete | Todo | |
| `GET/PATCH /admin/clients/:id` | Todo | |

### E5 — Quotes (`quotes`)

| Item | Status | Notes |
|------|--------|-------|
| `Quote` entity + lifecycle | Todo | |
| Client submit/list/accept | Todo | |
| Admin quote + assign chef | Todo | |

### E6 — Shopping lists (`shopping-lists`)

| Item | Status | Notes |
|------|--------|-------|
| Generate from meal ingredients × portions | Todo | |
| Expose on booking detail (client + admin) | Todo | |

### E7 — Messaging (`messaging`)

| Item | Status | Notes |
|------|--------|-------|
| `ChatThread` / `ChatMessage` persistence | Todo | |
| Stream channels + webhooks | Todo | |
| `/me/thread`, `/admin/threads` | Todo | |

### E8 — Payments (`payments`)

| Item | Status | Notes |
|------|--------|-------|
| `Payment` entity | Todo | |
| `POST /payments/intent` | Todo | |
| `POST /webhooks/stripe` | Todo | |
| Tax credit fields on booking/payment | Todo | |

### E9 — Notifications (`notifications`)

| Item | Status | Notes |
|------|--------|-------|
| `Notification` entity + user preferences | Todo | |
| Brevo templates | Todo | |
| SMS provider (spec) — env + adapter | Todo | |
| `GET /admin/dashboard/badges` | Todo | |

### E10 — Stats (`stats`)

| Item | Status | Notes |
|------|--------|-------|
| `GET /me/dashboard`, `GET /me/stats` | Todo | |
| `GET /admin/dashboard` aggregations | Todo | |

### E11 — Main site / admin-only domains

| Item | Status | Notes |
|------|--------|-------|
| Kossam orders | Todo | |
| Chef applications + secure documents | Todo | S3 signed URLs |
| Contact messages + reply | Todo | |
| Reviews moderation | Todo | |
| Team & service zones | Todo | |
| `AdminSettings` singleton | Todo | |

### E12 — Infrastructure

| Item | Status | Notes |
|------|--------|-------|
| Enable Redis module | Todo | Queues for notifications |
| S3 upload APIs | Todo | Meals, application docs |
| Clerk JWKS verification | Todo | Phase 2 hardening |

## Implemented today (baseline)

| Area | Routes / artifacts |
|------|-------------------|
| Health | `GET /health`, `GET /ready` |
| Users | `GET /thisUser`, `GET /me` |
| Bookings | `GET /bookings`, `POST /bookings` (stub) |
| F19 CMS | `GET/PUT /content/concept`, `CmsPage`, migration `1700000000001` |
| Auth | `ClerkAuthGuard`, `AdminGuard` |
| Integrations | Stripe, Cronofy, Stream, Brevo, Supabase scaffolds |

## Module → spec traceability

| Spec module (SPEC-BACKEND §2.2) | NestJS module (target) | Status |
|--------------------------------|------------------------|--------|
| auth | Clerk + users upsert | Partial |
| users | `users` + profile | Partial |
| catalog | `catalog` | Not started |
| reservations | **`bookings`** | Scaffold |
| quotes | `quotes` | Not started |
| shopping-lists | `shopping-lists` | Not started |
| messaging | `messaging` + Stream | Not started |
| payments | `payments` | Not started |
| kossam | `kossam` | Not started |
| recruitment | `recruitment` | Not started |
| contact | `contact` | Not started |
| reviews | `reviews` | Not started |
| notifications | `notifications` | Not started |
| stats | `stats` | Not started |
| — | `content-cms` | **Done** (F19) |
| admin (SPEC-ADMIN) | `admin/*` controllers | Not started |

## Admin API checklist (all Todo)

`GET /admin/dashboard`, `GET /admin/dashboard/badges`, bookings CRUD/patch, quotes, threads, clients, meals, menu-weeks, formules, kossam-orders, applications (+ document download), contact-messages, reviews, team, zones, settings.

## Client API checklist (Todo except noted)

`GET /me/dashboard`, `/me/bookings`, booking detail/cancel, `/menus/current`, quotes, `/me/thread`, `/me/profile`, `/me/stats`, `/payments/intent`, `/webhooks/stripe`, account/settings/GDPR — plus **Done:** `GET /content/concept`, `GET /me`, `GET /thisUser`.

## Intentionally out of scope (spec vs stack)

| Spec item | Backend choice |
|-----------|----------------|
| `POST /auth/register`, `/login`, `/refresh` | Clerk handles auth |
| Prisma in spec as illustration only | Adopted as real ORM target |
| Route prefix `/me/reservations` | Use `/me/bookings` unless versioning adds alias |

## Change log

| Date | Change | Reason |
|------|--------|--------|
| 2026-05-22 | Created register; aligned stack, architecture, README, AGENTS, F19 doc paths | User request to document spec gap and decisions |
| 2026-05-22 | Recorded Prisma, Clerk, bookings, chef (deferred), Cronofy, Stream decisions | Team resolution on spec tensions |
| 2026-05-22 | **E0 done:** Prisma schema, migration, PrismaService, removed TypeORM | User-requested ORM switch |
| 2026-05-22 | Spec domain models + migration; seed JSON fix via `toInputJson` | Phase 1 + cms_pages todo cleared |
