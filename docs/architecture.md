# Backend architecture

This document describes the **LF-BackEnd** API only. Product intent and route contracts come from `[SPEC-BACKEND.md](./SPEC-BACKEND.md)` and `[SPEC-ADMIN-DASHBOARD.md](./SPEC-ADMIN-DASHBOARD.md)` (API sections). Stack choices are in `[../stack.md](../stack.md)`.

## Guiding specs


| Document                                               | Backend scope                                                                                                 |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| `[SPEC-BACKEND.md](./SPEC-BACKEND.md)`                 | Client/batch-cooking API, shared domain model, payments, notifications, stats                                 |
| `[SPEC-ADMIN-DASHBOARD.md](./SPEC-ADMIN-DASHBOARD.md)` | Admin REST surface (`/admin/*`), admin-only entities (Kossam, applications, contact, reviews, team, settings) |


Frontend apps (`labs-food`, `admin-labsfood`, `labs-food-main`) consume this API but are **not** documented here.

## Resolved implementation choices


| Topic             | Decision                                                                                             | Notes                                                                                  |
| ----------------- | ---------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| ORM               | **Prisma**                                                                                           | `PrismaService` + `apps/prisma/schema.prisma`                                          |
| Auth              | **Clerk**                                                                                            | No first-party `/auth/register` or password routes; JWT from Clerk on protected routes |
| Booking aggregate | `**bookings`**                                                                                       | Spec “reservation” maps to existing booking module/table naming                        |
| Chef role         | `**chef**` replaces `provider`                                                                       | E1 migration landed; `provider_id` columns kept temporarily for compatibility          |
| Calendar / chat   | **Cronofy** + **Stream**                                                                             | Kept per stack; wire to booking lifecycle and messaging modules                        |
| Tracking          | `[evolution/platform-spec-alignment-evolution.md](./evolution/platform-spec-alignment-evolution.md)` | Gap list and delivery status                                                           |


## Services in this repo


| Service    | Path                              | Role                                          | Default port |
| ---------- | --------------------------------- | --------------------------------------------- | ------------ |
| NestJS API | `[apps/](../apps/)` (`apps/src/`) | Primary REST API (OpenAPI/Swagger)            | 8000         |
| PostgreSQL | Docker / Supabase                 | Primary data store                            | 5432         |
| Redis      | Docker                            | Cache + async queues (module not enabled yet) | 6379         |


Database: **Prisma** (`apps/prisma/schema.prisma`). Local/Docker: `npm run db:migrate` or `prisma migrate deploy` in the API container entrypoint.

## Current module layout (implemented)

```
apps/src/
├── main.ts
├── app.module.ts
├── config/                    # env validation (Joi), config loader
├── prisma/
│   ├── schema.prisma
│   ├── migrations/
│   └── seed.ts
├── supabase/                  # DB module wrapper + shared types
│   ├── database.module.ts     # imports PrismaModule
│   ├── types/                 # CMS JSON shapes
│   └── enums.ts
├── auth/                      # ClerkAuthGuard, AdminGuard, CurrentClerkUser
├── integrations/              # Stripe, Cronofy, Stream, Brevo, Supabase (CMS assets)
├── redis/                     # scaffold (commented out of AppModule)
└── modules/
    ├── health/                # GET /health, GET /ready
    ├── users/                 # GET /thisUser, /me, /me/profile, /admin/clients/*
    ├── bookings/              # GET /bookings + detail routes with shopping list
    ├── catalog/               # /menus/current + admin meals/menu-weeks/formules
    ├── quotes/                # client/admin quote lifecycle
    ├── shopping-lists/        # ingredient aggregation service
    ├── stats/                 # /me/dashboard, /me/stats, /admin/dashboard
    └── content-cms/           # GET /content/concept, PUT /content/concept (F19)
```

Reserved: `modules/content/` for non-CMS app content.

## Target backend modules (from specs)

Modules below are the **planned** NestJS boundaries. None except those in “Current” are fully implemented.


| Module           | Responsibility                                        | Primary routes (spec)                                           |
| ---------------- | ----------------------------------------------------- | --------------------------------------------------------------- |
| `auth`           | Clerk session bridge, role resolution                 | *(no password routes)* — use Clerk + `UsersService` upsert      |
| `users`          | User row + **client profile** (CRM fields)            | `GET/PATCH /me/profile`, account/settings/GDPR                  |
| `catalog`        | Meals, weekly menu, formules                          | `GET /menus/current`; admin meals/menu-weeks/formules           |
| `bookings`       | Session lifecycle, reference `LF-…`, meals on booking | `GET /me/bookings`*, `POST /bookings`, cancel; admin list/patch |
| `shopping-lists` | Ingredient aggregation by aisle                       | Embedded in booking detail + admin                              |
| `quotes`         | Sur-mesure requests & quotes                          | `POST /quotes`, `/me/quotes`, admin `/admin/quotes`             |
| `messaging`      | Threads + Stream realtime                             | `/me/thread`, `/admin/threads`                                  |
| `payments`       | Stripe intents & webhooks, tax credit fields          | `/payments/intent`, `/webhooks/stripe`                          |
| `kossam`         | Kossam product orders                                 | Admin `/admin/kossam-orders`; public submit from main site      |
| `recruitment`    | Chef applications + documents                         | `/admin/applications`                                           |
| `contact`        | Site contact inbox                                    | `/admin/contact-messages`                                       |
| `reviews`        | Moderation & publish                                  | `/admin/reviews`                                                |
| `notifications`  | Email/SMS/in-app + preferences                        | Driven by booking/quote transitions                             |
| `stats`          | Dashboard aggregations                                | `GET /me/dashboard`, `GET /me/stats`, `GET /admin/dashboard`    |
| `admin`          | Guards, badges, settings singleton                    | `/admin/*`, `/admin/dashboard/badges`                           |
| `content-cms`    | Marketing “Notre Concept” page                        | **Done** — `/content/concept`                                   |
| `team`           | Chefs/staff & service zones                           | `/admin/team`, `/admin/zones`                                   |


Spec uses `/me/reservations`; implementation keeps `**bookings`** paths unless a versioned alias is added later.

## Booking lifecycle (target)

Spec state machine (stored on `bookings.status`):

```
pending → confirmed → shopping → cooking → delivered
                    ↘ cancelled
```

Phase 1 enum today: `pending`, `confirmed`, `cancelled`, `completed` — extend/rename toward spec on the bookings epic.

## Data model direction

### Implemented (Phase 1 + F19)

```mermaid
erDiagram
    users ||--o| chef_profiles : "chef_profile"
    users ||--o{ bookings : "client"
    chef_profiles ||--o{ service_offers : "offers"
    chef_profiles ||--o{ availability_slots : "exposes"
    chef_profiles ||--o{ bookings : "fulfills"
    service_offers ||--o{ bookings : "priced_as"
    users ||--o{ cms_pages : "updated_by"

    users {
      uuid id
      string clerk_user_id
      string email
      enum role
    }
    bookings {
      uuid id
      string reference
      enum status
      int price_cents
    }
    cms_pages {
      string slug
      jsonb content
    }
```



### Target additions (Prisma schema — spec-aligned)

Core shared entities: `ClientProfile`, `Meal`, `MenuWeek`, `Formule`, `BookingMeal` (junction), `ShoppingList`, `ShoppingItem`, `Quote`, `ChatThread`, `ChatMessage`, `Payment`, `Notification`.

Admin / main-site entities: `KossamOrder`, `KossamOrderItem`, `ChefApplication`, `ApplicationDocument`, `ContactMessage`, `Review`, `TeamMember`, `ServiceZone`, `AdminSettings`.

Logical ER (target — names follow spec; table `bookings` retained):

```mermaid
erDiagram
    users ||--o| client_profiles : "client"
    users ||--o{ bookings : "books"
    users ||--o{ quotes : "requests"
    bookings ||--o{ booking_meals : "includes"
    meals ||--o{ booking_meals : "selected"
    bookings ||--o| shopping_lists : "generates"
    bookings ||--o| payments : "paid_by"
    users ||--o{ chat_threads : "owns"
    chat_threads ||--o{ chat_messages : "contains"
```



`chef_profiles` can later converge with team modeling (`TeamMember`, chef assignment on `bookings`) in a later design pass.

## Authentication

- `ClerkAuthGuard` — Bearer JWT, payload decode (JWKS verification planned).
- `@CurrentClerkUser()` — exposes Clerk `sub` and email in controllers.
- `AdminGuard` — requires persisted `UserRole.ADMIN` after Clerk auth.
- Future: `ChefGuard` or scoped queries for `UserRole.CHEF`.

```mermaid
flowchart TB
  subgraph frontend [Frontend team — Next.js apps]
    UI[Sign-in / Sign-up UI]
    ClerkNext["@clerk/nextjs"]
    MW[clerkMiddleware — page guards]
    APIClient[API client → LF API]
  end

  subgraph clerk [Clerk cloud]
    FAPI[FAPI — sessions]
    Dash[Dashboard — auth methods, webhooks]
  end

  subgraph backend [Backend team — NestJS :8000]
    Guard[ClerkAuthGuard — verifyToken]
    WH["POST /webhooks/clerk"]
    Me["GET /me — upsert + role"]
    Biz[Bookings, CMS, admin routes…]
  end

  subgraph db [Postgres]
    Users[(users.role, profiles…)]
  end

  UI --> ClerkNext --> FAPI
  ClerkNext -->|getToken| APIClient
  APIClient -->|Bearer JWT| Guard --> Me --> Users
  Guard --> Biz
  Dash --> WH --> Users
  MW -.->|UX redirect only| UI

```


Protected today: `/thisUser`, `/me`, `/bookings`, `PUT /content/concept`. Public: `/health`, `/ready`, `GET /content/concept`, `GET /menus/current` (when implemented).

## Integrations


| Service      | Config                                       | Status                                          |
| ------------ | -------------------------------------------- | ----------------------------------------------- |
| Stripe       | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | Client wrapper; webhooks & booking flow pending |
| Cronofy      | `CRONOFY_*`                                  | Scaffold; link to chef availability             |
| Stream       | `STREAM_*`                                   | Scaffold; link to messaging module              |
| Brevo        | `BREVO_*`                                    | Scaffold; notification templates pending        |
| AWS S3       | `AWS_*`                                      | Config only; uploads pending                    |
| Supabase API | `SUPABASE_*`, CMS bucket                     | Optional CMS asset storage                      |


## Health checks

- `GET /health` — liveness, no backing services.
- `GET /ready` — Postgres ping (+ Redis when enabled).

## API surface summary

### Implemented


| Method | Route               | Auth                     |
| ------ | ------------------- | ------------------------ |
| GET    | `/health`, `/ready` | public                   |
| GET    | `/content/concept`  | public                   |
| PUT    | `/content/concept`  | admin                    |
| GET    | `/thisUser`, `/me`  | Clerk                    |
| GET    | `/bookings`         | Clerk                    |
| POST   | `/bookings`         | Clerk (stub — not wired) |


### Client / public backlog (SPEC-BACKEND)

`GET /me/dashboard`, `/me/bookings` (or alias), booking detail/cancel, `/menus/current`, quotes, `/me/thread`, `/me/profile`, `/me/stats`, `/payments/intent`, `/webhooks/stripe`, account/GDPR routes.

### Admin backlog (SPEC-ADMIN-DASHBOARD)

`/admin/dashboard`, `/admin/dashboard/badges`, reservations (bookings), quotes, threads, clients, meals, menu-weeks, formules, kossam-orders, applications, contact-messages, reviews, team, zones, settings.

## Documentation map


| File                                                                                                 | Role                        |
| ---------------------------------------------------------------------------------------------------- | --------------------------- |
| `[features/f19-concept-cms.md](./features/f19-concept-cms.md)`                                       | F19 scope (shipped)         |
| `[evolution/f19-concept-cms-evolution.md](./evolution/f19-concept-cms-evolution.md)`                 | F19 change register         |
| `[evolution/platform-spec-alignment-evolution.md](./evolution/platform-spec-alignment-evolution.md)` | Platform spec gap & backlog |
| `[database-connection.md](./database-connection.md)`                                                 | Supabase URLs               |
| `[Revisions_followup.md](./Revisions_followup.md)`                                                   | Release register            |


