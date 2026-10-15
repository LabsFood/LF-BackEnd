# Role-segmented bookings, batch cooker availability and Cronofy

> **2026-10-14: Phase C (Cronofy) was dropped and rolled back.** The calendar is built in-house:
> see [`in-house-calendar.plan.md`](./in-house-calendar.plan.md). Phases A and B stand. Everything
> below about Cronofy, tokens, `CRONOFY_*`, `chef_calendar_connections` and `syncBooking` is history.

## Context

**Bookings.** The bookings API is still a read-only stub under `@Controller('bookings')`:
- `GET /bookings` (admin, unpaginated) and `GET /bookings/me`
- `GET /bookings/me/bookings/:id` and `GET /bookings/admin/bookings/:id`
- the admin shopping-list regenerate route
- `POST /bookings`, which answers 501

Bookings are created only by accepting a quote offer. Their only status change is `pending → confirmed` by payment. The payments module adds:
- `GET /me/bookings/:id/payment-options`
- `GET /me/bookings/:id/payment-status`
- `POST /bookings/:id/settle`

The batch cooker has no "Mes prestations" list.

**Cronofy.** It is still configuration only.
- The `baseUrl` of `CronofyService` builds wrong hosts (`api-cronofy.com`, `api-de-cronofy.com`).
- `ChefProfile.cronofyProfileId` and `Booking.cronofyEventId` are never written.

**Availability.** It exists only as seeded `availability_slots` rows read by the vitrine. In batchcooking-web, the agenda and "Prestations" pages still read `lib/chef/mock.ts`. The agenda's model (`lib/chef/schedule.ts`) is a weekly template plus date exceptions.

**Intended outcome:**
1. Bookings segmented by audience, each with GET, POST and PATCH limited to what it may see:
   - client: their own bookings
   - batch cooker: their own bookings, filterable by client
   - admin: every booking
2. Working hours stored in our database, matching the agenda UI.
3. Cronofy:
   - The batch cooker connects their calendar.
   - Bookings are checked against working hours minus calendar busy time minus other bookings.
   - Every live booking appears in the batch cooker's calendar, and is removed on cancel.

**Decisions taken with the user (revised by #53 where marked):**
- **Routes:** `/me/bookings`, `/chef/bookings` and `/admin/bookings`. The old `/bookings/*` routes stay as deprecated aliases with unchanged shapes for one release, because the admin console uses them.
- **Creation:** POST creates a `pending` booking, priced on the server, with reference `LF-YYYY-NNNN` and its recipes pinned. *Revised:* paying it is what confirms it.
- **Status flow:** `pending → confirmed → shopping → cooking → delivered → completed`, plus `cancelled`.
- **Bookings made by a batch cooker:** the batch cooker books for a client they already know; the booking is `pending` and *(revised)* the client accepts it by paying.
- **Cronofy:**
  - scope: connect the calendar, check availability, push events
  - working hours come from our database, with Cronofy busy time subtracted
  - data center `de` (EU).
  - tokens encrypted with AES-256-GCM

Delivery is in **three phases**, each shippable and testable on its own: A (bookings), then B (availability), then C (Cronofy).

---

## Phase A: role-segmented bookings

### Controllers
New files in `src/modules/bookings/`:
- **`me-bookings.controller.ts`:** `@Controller('me/bookings')`, `ClerkAuthGuard`, tag `bookings`.
  - It sits next to the payment routes `me/bookings/:id/payment-options` and `payment-status`, which live in PaymentsModule. The paths don't clash.
- **`chef-bookings.controller.ts`:** `@Controller('chef/bookings')`, `ClerkAuthGuard`, new tag `chefBookings`.
  - The batch cooker comes from `users.chefIdentity`: 404 `NOT_A_CHEF`, 403 `CHEF_NOT_VERIFIED`.
- **`admin-bookings.controller.ts`:** `@Controller('admin/bookings')`, `ClerkAuthGuard` and `AdminGuard`, tag `adminBookings`.

`bookings.controller.ts` keeps its six routes unchanged and adds `deprecated: true` plus "Use `…`" to each.
- `POST /bookings` keeps answering 501 and points to `POST /me/bookings`.
- The old service methods (`list`, `listMine`, `getMyBookingDetail` with `chefCesu`, `getAdminBookingDetail`) stay until the next release.

### Routes
- All `:id` params use `ParseUUIDPipe`. Errors are shaped `{code, message}`.
- Lists return `{data, meta}` via `resolvePageBounds` and `buildPaginationMeta`.

| Audience | GET list | GET :id | POST | PATCH :id |
|---|---|---|---|---|
| Client `/me/bookings` | `?status&from&to&page&limit`, newest first | own bookings, with `chefCesu` as today | `NewBookingDto` | `UpdateBookingDto` |
| Batch cooker `/chef/bookings` | adds `?clientId=`; `startsAt` ascending (agenda) | own bookings | `NewBookingForClientDto` | `ChefUpdateBookingDto` (status only) |
| Admin `/admin/bookings` | adds `?clientId&chefId=`; newest first | any booking, client email included | `NewBookingForClientDto` | `AdminUpdateBookingDto` |

- `POST /admin/bookings/:id/shopping-list/regenerate` uses the same handler as the old route.
- Status changes go through `PATCH` with `status` in the body.
- Payment keeps its own routes in PaymentsModule.
- **Prestation photos** (batch cooker only). These follow the three-step dish photo flow (`dishes/content-photos.service.ts`) and reuse `PhotoUploadDto` and `PhotoConfirmDto` (`dishes/dto/photo.dto.ts`):
  - `POST /chef/bookings/:id/photos/upload-url`: `{contentType, sizeBytes}` → `R2StorageService.presignPhoto('bookings/<id>/', …)`.
  - `POST /chef/bookings/:id/photos`: `{uploadId, contentType, caption?}` → `confirmPhoto`, then creates a `BookingPhoto` row and returns the photo list.
  - `DELETE /chef/bookings/:id/photos/:photoId`: deletes the row; `r2.delete` is best-effort.
  - Allowed once the prestation has started: status `shopping`, `cooking`, `delivered` or `completed`. Otherwise 409 `NOT_STARTED`.
  - At most 20 photos per booking (409 `TOO_MANY_PHOTOS`).

### Status rules: `bookings/domain/booking-status.ts`
- One pure function, `canTransition(actor, from, to)`.
- It exports `GOING_AHEAD = ['confirmed','shopping','cooking','delivered']`.

| Change | Allowed actors | Condition (checked in the service) |
|---|---|---|
| `pending → confirmed` | none through PATCH; only `settlePayment` once fully paid, or an admin | none |
| `pending → cancelled` | client, batch cooker | nothing paid yet |
| `confirmed → cancelled` | client, batch cooker | nothing paid and before `startsAt` (quote bookings are paid after the prestation). Otherwise 409 `BOOKING_PAID` and an admin cancels it |
| `confirmed → shopping`, `cooking → delivered` | batch cooker | none |
| `confirmed → cooking`, `shopping → cooking` (arrival on site) | batch cooker | no earlier than 2 h before `startsAt`, else 409 `TOO_EARLY`. The first one sets `arrivedAt = now` |
| `delivered → completed` | client, batch cooker | none |
| any change | admin | audited. A paid booking an admin cancels is refunded by hand in Stripe. `ponytail:` no refund flow yet; see `payments.service.ts:571` |

### Service: `bookings.service.ts`
New methods `listFor`, `detailFor`, `create`, `update` and `expireUnpaid` (Phase B); the first four take the role.

**Who is calling:**
- client: `users.ensurePersistedFromClerk`
- batch cooker: `users.chefIdentity(clerkId)`, moved from `QuotesService.chefIdentity`, which then delegates to it in one line
- admin: `users.findByClerkId`, used as the audit actor

**Role filter:** `{clientId}`, `{chefProfileId}` or `{}`, spread **last** into every `where`. Anything outside it is a 404.

**What lists and details read** (one query per list, no per-row lookups):
- `payments` with status `pending` or `succeeded`: `method`, `status`, `amountTtc`, `commission.amountTtcCents`
- `quote.offers` where `status: 'accepted'` (`take: 1`): `netCents`, `clientPriceCents`
- detail only:
  - `client.clientProfile`: `allergies`, `dietaryPreferences`
  - `quote`: `allergies`, `diet`
  - `photos`
- once per request, for batch cooker and admin calls: the commission rate in force, `PlatformSettingsService.commissionBps()`

**Earnings** (`net` and `commission`, batch cooker and admin views only):
- They come from a pure function `bookingEarnings(booking, rates)` in `bookings/domain/earnings.ts`.
- Paid part: the commission frozen when each payment was taken, the sum of `Commission.amountTtcCents` on `succeeded` payments.
- Unpaid part: priced by `commissionFor(offer, remainingCents, rates)`.
  - This is the pure core of `commissionForPayment`, extracted in `payments/commission-policy.ts`; the existing function keeps its signature and calls it.
  - A quote booking keeps the accepted offer's deal. A direct booking uses the rate in force, with the VAT on the commission from `payments.commissionVatRateBps`, as `PaymentsService.commissionOn` does.
- Results:
  - `commissionCents` = paid part + unpaid part
  - `netCents = amountTtc − commissionCents`
  - `commissionEstimated = remainingCents > 0`, so the screen can show "≈" until the booking is fully paid

**Create:**
1. `startsAt` must be in the future (422).
2. The offer must be active, and its batch cooker `isActive && isVerified`. A batch cooker caller may only use their own offer. Otherwise 404 `OFFER_NOT_FOUND`.
   - The quote flow's "Sur-mesure" offer has `isActive: false`, so it is excluded automatically.
3. `findCommissionBlock(prisma, chefProfileId, payments.commissionDebitMaxAttempts)` → 409 `COMMISSION_UNPAID`.
4. Batch cooker callers only: the client must be known to them, through an earlier non-cancelled booking or a conversation pair. Otherwise 404 `CLIENT_NOT_FOUND`.
5. Booking yourself → 409 `SAME_PERSON`.
6. A formule must be active (422).
7. Meals must be published and belong to that batch cooker, or be shared catalog dishes (422). Duplicates are rejected in the DTO with `ArrayUnique`.
8. *(Phase B and later)* `availability.assertBookable(chefProfileId, startsAt, endsAt)` → 409 `SLOT_UNAVAILABLE`. Admin calls skip it (audited).
9. Computed values:
   - `endsAt = startsAt + offer.durationMinutes`
   - price = `formule.priceTtc ?? offer.priceCents`, written to both `priceCents` and `amountTtc`
   - `amountAfterTax = formule?.priceAfterTax ?? afterTaxCredit(price)`. `afterTaxCredit` is extracted from `priceOffer` in `quote.rules.ts` (same formula, `TAX_CREDIT_BPS`).
   - No commission is stored: `commissionForPayment` applies the rate in force when the booking is paid.
10. The reference is `LF-YYYY-NNNN`: the count of references starting with `LF-YYYY-`, plus one.
    - Quote bookings use `LF-SM-…` and are not counted.
    - On P2002 it retries, up to 5 times. `ponytail:` switch to a per-year sequence if this contends.
11. After the commit:
    - `shoppingLists.pinRecipes(id)` runs best-effort
    - an admin create writes `audit.record('booking.created')`
    - *(Phase C)* `calendar.syncBooking`

**Update:**
1. Load the booking within the role filter.
2. Only the client and admin DTOs can change fields.
   - A non-admin can change fields only while the booking is `pending`; otherwise 409 `BOOKING_LOCKED`.
   - The batch cooker's DTO has only `status`, so any other field is a 400 through `forbidNonWhitelisted`.
   - A batch cooker who wants another time cancels the booking and books again.
3. A changed `startsAt` recomputes `endsAt` and runs `assertBookable` again, ignoring this booking.
4. `canTransition` must pass, else 409 `INVALID_TRANSITION`.
   - A cancel by the client or batch cooker also needs `coveredAmount(prisma, id) === 0` (`payment-settlement.ts`) and a booking that hasn't started. Otherwise 409 `BOOKING_PAID`.
5. The write is one `$transaction`:
   - replace the meals if sent
   - `booking.update({ where: { id, status: b.status } })`
   - P2025 becomes 409 `CHANGED_MEANWHILE` via `changedMeanwhile` (`dishes/dishes.service.ts`)
6. After the commit, all best-effort:
   - meals changed → `shoppingLists.regenerateForBooking`
   - an admin caller → audit entry
   - *(Phase C)* `calendar.syncBooking`
   - `ponytail:` a Stripe intent already open on a booking that gets cancelled can still succeed. `settlePayment` won't revive the booking, but that money is refunded by hand.

### Views, DTOs and other Phase A edits
- **Views** (`bookings.views.ts`, following the `dishes.views.ts` pattern):
  - **List item** (the "Mes prestations" display):
    - `id, reference, status, startsAt, endsAt, bookingDate, timeSlot, persons, addressLine, notes, shoppingByClient, priceCents, amountTtc, amountAfterTax, currency, createdAt, mealsCount`
    - `client: {id, name, avatarUrl}`. The batch cooker view runs the name through `shortName` (`messaging/domain/messaging.rules.ts`); the admin view adds `email`.
    - `chef: {id, displayName}`, `serviceOffer: {id, name}`, `formule: {id, name} | null`
    - `arrivedAt`
    - `paymentMethods`: the distinct `Payment.method` values (`cb`, `avance_immediate`, `cesu`) of `pending` and `succeeded` payments, `[]` while none. A booking can be split between CESU and card, so it is an array.
    - `paidCents`: the sum of `succeeded` payments, read from the same rows
    - batch cooker and admin views only: `netCents`, `commissionCents`, `commissionEstimated`
  - **Detail** adds:
    - `meals: [{mealId, name, portions, recipeVersion}]`, with no recipe fields (FLOW-02 §8)
    - `photos: [{id, url, caption, takenAt}]`, for all three audiences (they go with the report to the client)
    - batch cooker and admin views only: `allergies` and `diets`. These are read live from the client profile (`allergies`, `dietaryPreferences`), merged with the quote's `allergies` and `diet` for a quote booking, without duplicates.
      - They are read live because an allergy added after booking must reach the cook.
      - They stay out of the list to keep health data to the screen that needs it.
    - The client detail keeps `chefCesu`.
- **DTOs** (`dto/bookings.dto.ts`):
  - `BookingsQueryDto` extends `PaginationQueryDto` with `status`, `from` and `to`.
  - `ChefBookingsQueryDto` adds `clientId`; `AdminBookingsQueryDto` adds `clientId` and `chefId`.
  - `NewBookingDto`:
    - `serviceOfferId`, `formuleId?`, `startsAt`
    - `persons?`, `addressLine?`, `notes?`, `shoppingByClient?`
    - `meals?` (at most 20, unique)
  - `NewBookingForClientDto` adds `clientId`.
  - `UpdateBookingDto` (client): `startsAt?`, `persons?`, `addressLine?`, `notes?`, `shoppingByClient?`, `meals?`, and `status?` limited to `cancelled` or `completed`.
  - `ChefUpdateBookingDto`: `status`, one of `cancelled`, `shopping`, `cooking`, `delivered` or `completed`.
  - `AdminUpdateBookingDto`: the client fields, any `status`, and `priceCents`, `amountTtc` and `amountAfterTax`.
- **Prisma:**
  - Add `shopping`, `cooking` and `delivered` to `BookingStatus`. The database already has them, and `paymentPhase` already handles them through its `default` branch.
  - Add `arrivedAt DateTime? @map("arrived_at") @db.Timestamptz(6)` to `Booking`. It is set only by the first move to `cooking`.
  - Add a new model:

```prisma
model BookingPhoto {               // @@map("booking_photos")
  id, bookingId (FK bookings, cascade), url String @db.VarChar(512), caption String? @db.VarChar(160),
  uploadedByUserId String? @db.Uuid (FK users, set null), takenAt DateTime @default(now()) @db.Timestamptz(6),
  @@index([bookingId, takenAt])
}
```
- **Messaging** (`messaging/domain/messaging.rules.ts`):
  - `PairBooking.status` becomes `Exclude<BookingStatus,'cancelled'>`.
  - Contact release uses `GOING_AHEAD`.
  - `isWritable` becomes `status !== 'completed' || endsAt + grace >= now`.
  - Fix the `ensurePair` comment in `messaging.module.ts`: quotes use it, and bookings open conversations on demand.
- **Wiring:** `bookings.module.ts` registers the four controllers and imports `PlatformSettingsModule`, for the rate in force.
  - `PlatformSettingsModule` only imports `UsersModule`, so there is no cycle.
  - `coveredAmount`, `findCommissionBlock` and `commissionFor` are plain functions; `AuditModule` is global; `R2StorageService` comes from the global IntegrationsModule.
- **Swagger:** add `chefBookings` to `common/swagger/tags.ts` with its `TAG_DESCRIPTIONS` entry. The status enum in `booking-read.dto.ts` gets the new statuses.
- **Stale text to fix:** `docs/architecture.md:56` (module tree), `:77` (bookings row), `:102-109` (lifecycle) and `:273` (route table).

### e-CESU proof of payment (payments module)
The CESU flow stays as it is: the client declares (`POST /payments/cesu`), the batch cooker confirms receipt (`POST /me/chef/cesu-payments/:id/confirm`), and that confirmation settles the payment and confirms the booking.

The proof is **required** for e-CESU.
- The client attaches the issuer's confirmation (a PDF or a screenshot) **when declaring**. An e-CESU declaration without it is refused, so the booking cannot move forward without it.
- The batch cooker still confirms receipt, and that confirmation is still what settles the payment. The proof doesn't replace it.
- The proof is Lab's Food's legal evidence if the batch cooker and client disagree, for example after a `reject` saying the funds never arrived.
- Paper CESU (`cesu_paper`) is unchanged: the batch cooker receives the paper titres themselves.

**Storage:**
- the **private** Supabase bucket, through `KycStorageService` (`chef-onboarding/services/kyc-storage.service.ts`), under the path `cesu-proofs/<bookingId>/proof/<uploadId>`
  - The path is keyed on the booking because the file is uploaded **before** the payment exists.
- formats PDF, JPEG, PNG or WebP, at most 10 MB, as KYC documents
- no public URL; reading goes through a 5-minute signed link
- `ChefOnboardingModule` exports `KycStorageService` and `PaymentsModule` imports it. ChefOnboarding imports only `UsersModule`, so there is no cycle.

**Prisma:** `CesuSettlement` gains:
- `clientProofPath String? @map("client_proof_path") @db.VarChar(255)`
- `clientProofUploadedAt DateTime? @map("client_proof_uploaded_at") @db.Timestamptz(6)`

In the migration, `CHECK (medium <> 'ecesu' OR client_proof_path IS NOT NULL) NOT VALID`.
- The database enforces the rule on every new row.
- Older declarations without a proof stay readable and confirmable.
- The comment on `clientProofRef` ("never a proof") is updated: the free-text reference stays optional, and the document is the evidence.

**Flow:**
1. `POST /me/bookings/:id/cesu-proof/upload-url` `{contentType, sizeBytes}` (the booking's client, while the booking is payable) returns a signed upload from `KycStorageService.createUploadUrl` and an `uploadId`.
2. The browser uploads the file straight to the bucket.
3. `POST /payments/cesu` gains `proofUploadId`.
   - It is required when `medium = 'ecesu'`: `@ValidateIf` plus `@IsString`, else 400.
   - `declare` runs `statObject` on `cesu-proofs/<bookingId>/proof/<proofUploadId>`. A missing file is a 422 `PROOF_MISSING`.
   - It then writes `clientProofPath` and `clientProofUploadedAt` in the same `cesuSettlement.create` as today.

**Other routes** (in `cesu-payments.controller.ts`):

| Route | Who | Does |
|---|---|---|
| `PUT /me/cesu-payments/:id/proof` `{uploadId}` | the client who declared it | replaces a wrong file (upload it first through step 1) |
| `GET /me/cesu-payments/:id/proof-url` | same | a 5-minute signed link |
| `GET /admin/cesu-payments/:id/proof-url` | admin | the same, for a dispute |

**Rules:**
- A proof can be replaced only while the settlement is `declared`; the old object is removed best-effort.
- After `confirmed` or `rejected`, it is frozen (409 `PROOF_LOCKED`), since it is evidence.
- Someone else's booking or payment → 404.
- `ponytail:` a file uploaded but never declared stays in the bucket. That costs storage, never correctness; add a sweep if it grows.

**Visibility:** `CesuPaymentDto` gains `proofUploadedAt`, so the batch cooker's list and the admin's list show that a proof exists. The batch cooker doesn't get the file itself; it is evidence for Lab's Food.

---

## Phase B: working hours and computed availability (no Cronofy needed)

### Prisma
Mirrors `batchcooking-web/lib/chef/schedule.ts`. Times are minutes since midnight in Europe/Paris.

```prisma
model ChefWorkingHour {            // @@map("chef_working_hours")
  id, chefProfileId (FK chef_profiles, cascade), weekday Int /* 0 = Monday, as WEEKDAYS */,
  startMinute Int, endMinute Int, @@index([chefProfileId])
}
model ChefAvailabilityException {  // @@map("chef_availability_exceptions")
  id, chefProfileId (FK, cascade), date DateTime @db.Date, kind String @db.VarChar(8) /* extra | closed */,
  startMinute Int?, endMinute Int?, reason String? @db.VarChar(255), @@index([chefProfileId, date])
}
```

### Domain
- **`common/paris-time.ts`:** `parisOffsetMs`, `parisTime` and `parisToday` move out of `quotes/domain/quote.rules.ts`, which imports them back.
  - `ponytail:` the offset is computed in one pass, so it is wrong only for wall times inside the hour skipped when clocks go forward (02:00–03:00 on that Sunday). Working hours never fall there.
- **`calendar/domain/availability.rules.ts`:**
  - `workingRanges(template, exceptions, from, to)`: a `closed` exception removes the day; an `extra` exception adds a range.
  - `subtract(ranges, busy[])` gives the free ranges.
  - `startTimes(free, durationMinutes, step = 30)` gives the bookable start instants.

### Service: `calendar/availability.service.ts`
- `getSchedule(chefProfileId)` and `replaceSchedule(chefProfileId, dto)`: `deleteMany` plus `createMany` in one transaction.
- `busy(chefProfileId, from, to)`:
  - that batch cooker's bookings in `pending` or `GOING_AHEAD`, quote bookings included
  - plus Cronofy busy time (Phase C; empty when not connected)
- `freeSlots(chefProfileId, from, to, durationMinutes)` = `startTimes(subtract(workingRanges, busy))`.
- `assertBookable(chefProfileId, startsAt, endsAt, ignoreBookingId?)`: the range must lie inside a working range and overlap no busy period. Otherwise 409 `SLOT_UNAVAILABLE`.

### How long a pending booking holds its slot: `BookingsService.expireUnpaid`
- A `pending` booking holds its slot for **72 h**. A reminder goes to **both the client and the batch cooker** at 48 h, when 24 h are left to pay.
- "Unpaid" means no `pending` or `succeeded` payment. A CESU payment that was declared but not yet confirmed is `pending`, so it stops both the reminder and the expiry.
- One `@Cron(EVERY_HOUR)` job does both steps. `ScheduleModule` is already registered in `app.module.ts`.
  1. **Reminder:** unpaid `pending` bookings created more than 48 h ago with `holdReminderSentAt: null`.
     - Each one is claimed with `updateMany({ where: { id, holdReminderSentAt: null }, data: { holdReminderSentAt: now } })` and mailed only when `count === 1`, so several replicas never send it twice.
     - The emails are best-effort and sent through a new `BookingsMailer` (`bookings.mailer.ts`, following `quotes.mailer.ts`).
     - Client email: the reference, date, batch cooker, amount, the time the slot is freed (`createdAt + 72 h`), and a link to pay.
     - Batch cooker email: the same, saying the client hasn't paid yet.
  2. **Expiry:** unpaid `pending` bookings created more than 72 h ago move to `cancelled`.
     - This uses `updateMany` with `status: 'pending'` in the `where`, the same multi-replica pattern as `QuoteOffersService.expireDue`.
     - *(Phase C)* It also deletes the calendar event.
- **Prisma:** `Booking` gains `holdReminderSentAt DateTime? @map("hold_reminder_sent_at") @db.Timestamptz(6)`.
- **Brevo:**
  - two new templates, `brevo/templates/BREVO_TPL_BOOKING_HOLD_REMINDER_CLIENT.html` and `BREVO_TPL_BOOKING_HOLD_REMINDER_CHEF.html`, listed in `brevo/README.md`
  - their ids are read as `BREVO_TPL_BOOKING_HOLD_REMINDER_CLIENT` and `BREVO_TPL_BOOKING_HOLD_REMINDER_CHEF` (optional numbers in `config.loader.ts` and `env.validation.ts`, plus root `.env.example`)
  - Without an id the email is skipped and logged, as for the other templates.
  - The templates are created in Brevo (I can do it with the Brevo connector on request); their ids then go on **Railway** (develop, then staging and production).

### Routes
- `GET /chef/availability` and `PUT /chef/availability`: the weekly template and the exceptions.
  - `PUT` replaces the whole schedule.
  - Validation: `0 ≤ start < end ≤ 1440`, `weekday` 0–6, no overlapping ranges on the same day, at most 50 exceptions.
- `GET /chef/availability/slots?from&to&durationMinutes`: the batch cooker previews their free time.
- `GET /chefs/:chefId/availability?offerId&from&to`: **public** and throttled, sitting next to `chefs/:id` and `chefs/:chefProfileId/cesu-info`.
  - The window is capped at 31 days.
  - It returns free start times only, never what makes a time busy.

### Not included
- The vitrine's `slotsLeft` still reads `availability_slots`. A `ponytail:` comment in `vitrine.service.ts` marks it.
- A quote offer's proposed date isn't checked against availability. The follow-up is `assertBookable` when an offer is sent.

---

## Phase C: Cronofy (connect, free/busy, events), data center `de`

### Config and fix
- In `config.loader.ts` (around line 224) and `env.validation.ts` (around line 100):
  - `CRONOFY_DATA_CENTER` is validated as one of `uk`, `de`.
  - Add `CRONOFY_REDIRECT_URI` (the batchcooking-web callback page, e.g. `https://batchcooking.labsfood.fr/espace-chef/agenda/cronofy`.) and `CRONOFY_TOKEN_KEY` (32 bytes, base64).
  - All stay optional. Without them, the calendar routes answer 503 `CALENDAR_UNAVAILABLE`, as R2 does.
- **Fix `CronofyService`** (unchanged by #53):
  - `apiUrl` is `https://api.cronofy.com` for `us`, else `https://api-{dc}.cronofy.com`.
  - `appUrl` is `https://app.cronofy.com` for `us`, else `https://app-{dc}.cronofy.com`.
  - Update `cronofy.service.spec.ts`.
- Add the new variables to the root `.env.example` (lines 93–97) and to `docs/deploy/railway.md`.
- **Railway** (always add new variables in railway): `CRONOFY_DATA_CENTER=de`, `CRONOFY_CLIENT_ID`, `CRONOFY_CLIENT_SECRET`, `CRONOFY_REDIRECT_URI` and `CRONOFY_TOKEN_KEY`.
  - Set them on develop first, then staging and production.
  - The Cronofy application must be created in the **de** data center.

### API client: `src/integrations/cronofy.service.ts`
- Native `fetch`, no SDK.
- Methods:
  - `authorizeUrl(state)`
  - `exchangeCode(code)` and `refresh(refreshToken)`
  - `revoke(token)`
  - `listCalendars(accessToken)`
  - `freeBusy(accessToken, from, to)`, following `pages.next_page`
  - `upsertEvent(accessToken, calendarId, event)`: `event_id` is our booking id, so it is idempotent
  - `deleteEvent(accessToken, calendarId, eventId)`
- Scopes: `read_account list_calendars read_free_busy create_event delete_event`. **Check the scope names and the free/busy window limit against the Cronofy docs before coding.**

### Token encryption: `src/common/crypto/secret-box.ts`
`seal` and `open`: AES-256-GCM, random 12-byte IV, stored as `v1.<iv>.<tag>.<ciphertext>` (base64url). It comes with a round-trip test and a tamper test.

### Prisma
```prisma
model ChefCalendarConnection {     // @@map("chef_calendar_connections")
  id, chefProfileId String @unique (FK, cascade), cronofySub String @db.VarChar(128),
  providerName String?, profileName String?, calendarId String? @db.VarChar(128),
  accessTokenSealed String, refreshTokenSealed String, accessTokenExpiresAt DateTime @db.Timestamptz(6),
  status String @default("active") @db.VarChar(16) /* active | revoked */, lastError String?,
  createdAt, updatedAt
}
```
- `ChefProfile.cronofyProfileId` gets the linked profile id.
- `Booking.cronofyEventId` is set once the event has been pushed.

### Calendar module: `src/modules/calendar/`
- Contents:
  - services: `AvailabilityService` and `CalendarConnectionService`
  - controllers: `ChefCalendarController`, `ChefAvailabilityController` and `PublicAvailabilityController`
- It exports both services.
- BookingsModule and QuotesModule import it. It reads `prisma.booking` directly and never imports either module, so there is no cycle.
- **OAuth flow:**
  1. `GET /chef/calendar/connect-url` returns `{url}`. The `state` is an HMAC-signed `chefProfileId.expiry.nonce`, signed with `CRONOFY_TOKEN_KEY` and valid 10 min.
  2. Cronofy redirects to `CRONOFY_REDIRECT_URI` (a batchcooking-web page) with `code` and `state`.
  3. That page calls `POST /chef/calendar/connect {code, state}`. The backend checks the HMAC, the expiry, and that the state's batch cooker is the caller. It then:
     - exchanges the code
     - seals the tokens
     - upserts the connection
     - sets `cronofyProfileId`
     - picks the primary or first writable calendar
- **Other routes:**
  - `GET /chef/calendar`
  - `PATCH /chef/calendar {calendarId}`: the calendar must be in `listCalendars`
  - `DELETE /chef/calendar`: revokes best-effort and deletes the connection
- **`accessToken(conn)`:**
  - It refreshes when the token expires within 60 s, and retries once after a 401.
  - On `invalid_grant` it sets `status='revoked'`, and availability falls back to working hours minus bookings.
  - `ponytail:` concurrent refreshes aren't locked.

### Booking integration
- **`AvailabilityService.busy`** adds `cronofy.freeBusy` (statuses `busy` and `tentative`) for an active connection.
  - If Cronofy errors, it logs and continues without calendar busy time.
  - `ponytail:` no cache; add a short Redis cache if latency matters.
- **`calendar.syncBooking(booking)`** runs best-effort after every booking write:

| Booking state | Calendar action |
|---|---|
| any status except `cancelled`, batch cooker connected | `upsertEvent` (summary "Prestation LF-…", client short name, address, start and end), then `cronofyEventId = booking.id` |
| `cancelled` (including expiry), with `cronofyEventId` set | `deleteEvent` |

- `pending` bookings are pushed too, because they already hold the slot. So a payment that confirms a booking needs no hook in PaymentsModule.
- Callers:
  - `BookingsService`: create, update and `expireUnpaid`
  - `QuoteOffersService.afterAcceptance`, next to its `ensurePair` call
- `ponytail:` there is no retry queue; add a BullMQ or Redis retry if failures show up in the logs.
- **Not included:** Cronofy push notifications or webhooks, invites for the client's calendar, and the Cronofy UI Elements.

### Frontend dependency (batchcooking-web; NEVER touch it unless you ask)
Today `app/espace-chef/prestations` and `app/espace-chef/agenda` read `lib/chef/mock.ts`. The work there:
- a callback page at `CRONOFY_REDIRECT_URI`
- the agenda wired to `GET` and `PUT /chef/availability`
- "Prestations" wired to `GET /chef/bookings`
- booking wired to `GET /chefs/:id/availability`
- the client's e-CESU payment form: upload the proof (`POST /me/bookings/:id/cesu-proof/upload-url`, then a PUT to the signed URL) before `POST /payments/cesu` with `proofUploadId`

**Status mapping** to `MissionStatus` (`lib/chef/states.ts`):

| Backend status | `MissionStatus` |
|---|---|
| `pending` | `pending` |
| `confirmed` | `confirmed`, or `upcoming` (derived from the date) |
| `shopping`, `cooking` | `in-progress` |
| `delivered`, `completed` | `done` |
| `cancelled` | `cancelled` |

`disputed` has no backend status.

**Field mapping** to `ChefMission` (`lib/chef/mock.ts`):

| `ChefMission` field | API field |
|---|---|
| `net`, `commission` | `netCents`, `commissionCents` (cents, not euros); show "≈" while `commissionEstimated` |
| `allergies`, `diets` | the same names, on `GET /chef/bookings/:id` |
| `paymentMethod` | `paymentMethods[]`: `cb` → `card`, `avance_immediate` → `urssaf`, `cesu` → `cesu` |
| `photos` | `photos[]`; uploads go through the three photo routes, not the local object URLs the mock uses |
| `arrivedAt` | `arrivedAt`. The "Pointer mon arrivée" button sends `PATCH {status: 'cooking'}` |

---

## Migrations (written only, never applied by me)
- `20261014120000_booking_flow_fields` (Phase A):
  - `ALTER TABLE bookings ADD COLUMN IF NOT EXISTS arrived_at TIMESTAMPTZ(6)`
  - the `booking_photos` table, with FKs and the `(booking_id, taken_at)` index
  - `ALTER TABLE cesu_settlements ADD COLUMN IF NOT EXISTS client_proof_path VARCHAR(255)` and `client_proof_uploaded_at TIMESTAMPTZ(6)`
  - `ALTER TABLE cesu_settlements ADD CONSTRAINT ck_cesu_settlements_ecesu_proof CHECK (medium <> 'ecesu' OR client_proof_path IS NOT NULL) NOT VALID`
  - The enum values already exist through `20250522130000_spec_domain`.
- `20261014130000_chef_availability`:
  - the tables `chef_working_hours` and `chef_availability_exceptions`, with FKs and indexes
  - the checks `start_minute < end_minute` and `weekday BETWEEN 0 AND 6`
  - `ALTER TABLE bookings ADD COLUMN IF NOT EXISTS hold_reminder_sent_at TIMESTAMPTZ(6)`
- `20261014140000_chef_calendar_connections`: the table, with a unique `chef_profile_id` and an FK with cascade.

## Files
- **Phase A:**
  - new in `bookings/`:
    - `me-bookings.controller.ts`, `chef-bookings.controller.ts`, `admin-bookings.controller.ts`
    - `bookings.views.ts`, `dto/bookings.dto.ts`
    - `domain/booking-status.ts`, `domain/earnings.ts`, and their specs
    - `booking-photos.service.ts`
    - `prisma/migrations/20261014120000_booking_flow_fields/migration.sql`
  - modified:
    - `bookings.service.ts`, `bookings.controller.ts`, `bookings.module.ts`, both bookings specs
    - `users/users.service.ts` (gains `chefIdentity`), `quotes/quotes.service.ts` (delegates to it), `quotes/domain/quote.rules.ts` (exports `afterTaxCredit`)
    - `payments/commission-policy.ts` (extracts `commissionFor`; behaviour unchanged)
    - e-CESU proof: `payments/cesu-payments.controller.ts`, `cesu-payments.service.ts` and its spec, `dto/cesu.dto.ts`, `payments.module.ts`, `chef-onboarding/chef-onboarding.module.ts` (exports `KycStorageService`)
    - `messaging/domain/messaging.rules.ts` and its spec, `messaging/messaging.module.ts` (comment only)
    - `common/swagger/tags.ts`, `prisma/schema.prisma` (enum, `arrivedAt`, `BookingPhoto`, the two `CesuSettlement` columns), `docs/architecture.md`
- **Phase B:**
  - new:
    - `common/paris-time.ts`
    - in `calendar/`: `calendar.module.ts`, `availability.service.ts`, `chef-availability.controller.ts`, `public-availability.controller.ts`, `domain/availability.rules.ts` and its spec, `dto/availability.dto.ts`
  - modified:
    - `quotes/domain/quote.rules.ts` (imports the moved helpers)
    - `bookings.service.ts` (`expireUnpaid`), new `bookings.mailer.ts`
    - `config/config.loader.ts` and `config/env.validation.ts` (the two template ids), root `.env.example`, `brevo/templates/` (two new templates), `brevo/README.md`
    - `vitrine.service.ts` (`ponytail:` comment)
    - `app.module.ts`, `prisma/schema.prisma`
- **Phase C:**
  - new: `calendar/calendar-connection.service.ts`, `calendar/chef-calendar.controller.ts`, `common/crypto/secret-box.ts` and its spec
  - modified:
    - `integrations/cronofy.service.ts` and its spec, `config/config.loader.ts`, `config/env.validation.ts`
    - `quotes/quote-offers.service.ts`, `quotes/quotes.module.ts`
    - `.env.example`, `docs/deploy/railway.md`, `prisma/schema.prisma`

## Assumptions to confirm
1. **Decided:** `/chef/bookings`, `/chef/availability` and `/chef/calendar`, not `/me/chef/…`.
2. **Decided:** payment is the only thing that confirms a booking.
   - Card: the Stripe webhook.
   - Immediate advance: URSSAF's answer saying the payment succeeded.
   - e-CESU: the client **must** upload the issuer's proof to declare the payment, and the batch cooker still confirms receipt. The proof is kept privately as Lab's Food's legal evidence in a dispute. Paper CESU needs no upload.
   - There is no `requested_by` column. A client accepts a booking made by a batch cooker by paying it.
3. A client or batch cooker can cancel only an unpaid booking that hasn't started. A paid booking is cancelled by an admin and refunded by hand in Stripe for CB.
4. The formule price **replaces** the offer price. YES
5. An admin can set any status, and admin-created bookings skip the availability check (both audited).
6. Either side can close `delivered → completed`.
7. **Decided:** an unpaid pending booking holds its slot for 72 h, then is cancelled. A reminder goes to both the batch cooker and the client when 24 h are left.
8. The public availability endpoint needs no login.
9. Slot step 30 min, availability window at most 31 days, timezone Europe/Paris.
10. `net` and `commission` are shown to the batch cooker and admins only, never to the client.
11. `allergies` and `diets` are read live from the client profile (merged with the quote's), and only on the batch cooker and admin detail.
12. Arrival on site is the move to `cooking`, allowed from 2 h before `startsAt`. No separate check-in route.
13. Prestation photos sit in the public R2 bucket under an unguessable key, like dish photos: anyone holding the URL can open them. `ponytail:` the upgrade is a private bucket served by presigned GET.

## Verification
```
cd apps && npm ci
npx prisma generate && npx prisma validate          # SUPABASE_DB_URL must be set; no DB is contacted
npx jest src/modules/bookings src/modules/calendar src/modules/messaging src/modules/quotes src/modules/payments src/common src/integrations
npx tsc --noEmit && npm run lint && npm test
```

**Phase A tests:**
- `booking-status.spec.ts`: an `it.each` table of allowed and refused changes. `pending → confirmed` is refused to client and batch cooker.
- Service spec:
  - price from the offer and from the formule; `amountAfterTax` without a formule; `endsAt` from the offer's duration
  - the reference `LF-YYYY-0001` ignores `LF-SM-…` references, and retries after P2002
  - `pinRecipes` is called after create
  - `COMMISSION_UNPAID`, `SAME_PERSON`, and a batch cooker booking for an unknown client → 404
  - `BOOKING_LOCKED`, `INVALID_TRANSITION`, `BOOKING_PAID` (with `coveredAmount > 0`), `CHANGED_MEANWHILE`
  - the client list `where` keeps `clientId`
  - the first `→ cooking` sets `arrivedAt` and a later one doesn't overwrite it; `TOO_EARLY` more than 2 h before `startsAt`
  - the client view has no `netCents`, `commissionCents`, `allergies` or `diets`
  - `allergies` merges the profile and the quote without duplicates
- `earnings.spec.ts`:
  - a quote booking keeps the offer's deal
  - a direct booking uses the rate in force
  - a fully paid booking uses the frozen `Commission` rows, and `commissionEstimated` is false
  - a CESU and card split mixes frozen and estimated parts
- `commission-policy` and `payments.service` specs stay green after the extraction.
- CESU proof (`cesu-payments.service.spec.ts`):
  - an e-CESU `declare` without `proofUploadId` → 400
  - with an id whose file isn't in the bucket → 422 `PROOF_MISSING`
  - with the file → the settlement stores the path
  - paper CESU still declares without a proof
  - the upload link is refused on someone else's booking (404)
  - a replace works while `declared`, and is refused after `confirmed` or `rejected` (409 `PROOF_LOCKED`)
  - the admin link is signed and short-lived
- Photo service:
  - `NOT_STARTED` on a `confirmed` booking
  - `TOO_MANY_PHOTOS` at 21
  - another batch cooker's booking → 404
  - delete removes the row even when the R2 delete fails
- Controller spec:
  - `/admin/bookings` → 403 for client and batch cooker, 200 for admin
  - a bad UUID → 400
  - a batch cooker PATCH with `startsAt` → 400
  - the existing `GET /bookings` tests stay
- Messaging rules: the in-progress statuses behave like `confirmed`.

**Phase B tests:**
- `availability.rules.spec.ts`:
  - daylight-saving changes (the last Sunday of March and of October)
  - `closed` and `extra` exceptions
  - subtracting busy time, and start times that exactly fill a gap
  - `assertBookable` rejects a time outside working hours and an overlap
- `expireUnpaid`:
  - keeps bookings that have a `pending` or `succeeded` payment
  - reminds at 48 h, once, both sides; a second run sends nothing
  - cancels at 72 h
  - a booking paid between the reminder and 72 h is not cancelled
- `quote.rules.spec.ts` stays green after the move.

**Phase C tests:**
- `secret-box.spec.ts`: round trip; tampered data is rejected.
- `cronofy.service.spec.ts`: hosts for `de` and `uk`.
- Connection service, with `fetch` mocked:
  - the signed state is rejected when expired, tampered with, or for another batch cooker
  - a token near expiry is refreshed
  - `invalid_grant` marks the connection revoked
- `syncBooking`:
  - upserts on create and on accepting a quote offer
  - deletes on cancel and on expiry
  - a Cronofy failure doesn't fail the booking

**Manual end-to-end on develop** (after deploying and setting the env variables):
1. Connect a test Google calendar.
2. Check that a busy block in that calendar disappears from `GET /chefs/:id/availability`.
3. Create a booking, and see the event appear.
4. Pay it, and check the status becomes `confirmed`.
5. Cancel another one, and see its event disappear.

## Implementation notes (where the code differs from this plan)
- **Money in:** a cancel by the client or batch cooker, and the 72 h expiry, look for money that came in or is on its way: a `succeeded` payment, or a `pending` CESU or URSSAF one. A card intent left `pending` does not count, because an abandoned one stays `pending` for ever (`coveredAmount`). `paymentMethods` follows the same rule.
- **Rate in force:** read through `rateInForce` in `payments/commission-policy.ts`, with the same fallback the payments use (`PAYMENTS_COMMISSION_RATE_BPS`), so BookingsModule does not import PlatformSettingsModule.
- **Cronofy scopes:** `read_free_busy create_event delete_event`. The docs list no `read_account` or `list_calendars` scope, and listing calendars needs none.
- **Cronofy free/busy** leaves out the events this API wrote, so a booking's own event never blocks its reschedule.
- **Paris time:** two-pass, so wall times around both clock changes come out right; no `ponytail:` needed.
- **No working hours set:** `scheduled: false`, no slots offered, and a booking is checked against other bookings and the calendar only (the vitrine already shows such batch cookers "on request").
- **`BookingPhoto`** has no `uploadedByUserId`: only the booking's batch cooker uploads.
- **Messaging:** a `delivered` booking gets the same 14-day write grace as a `completed` one, instead of staying writable for ever.
- **References:** `LF-<year>-NNNN` uses the year the booking is made.
- **Extra error codes:** `BOOKING_STARTED`, `FORMULE_UNAVAILABLE`, `MEAL_UNAVAILABLE`, `PHOTO_NOT_FOUND`, `NO_PROOF`, `CALENDAR_NOT_CONNECTED`, `CALENDAR_NOT_WRITABLE`, `CALENDAR_CODE_REFUSED`.

## Status
- Branch `feat/bookings-roles-cronofy`, on top of `2f650e3`. Phases A → C are implemented in the working tree, **not committed**.
- Three migrations are written in `apps/prisma/migrations/`, **not applied**.
- New variables to set on Railway when this ships (develop, then staging and production): `CRONOFY_REDIRECT_URI`, `CRONOFY_TOKEN_KEY`, `BREVO_TPL_BOOKING_HOLD_REMINDER_CLIENT`, `BREVO_TPL_BOOKING_HOLD_REMINDER_CHEF`, plus `CRONOFY_DATA_CENTER=de` (any value other than `de` or `uk` stops the API at startup).
- No DB writes, no migration applied, and no commit or push without an explicit request.
