# Role-segmented bookings, batch cooker availability and Cronofy

## Context

**Bookings.** The bookings API is a read-only stub that mixes roles under `@Controller('bookings')`:
- `GET /bookings` (admin, unpaginated)
- `GET /bookings/me`
- `GET /bookings/me/bookings/:id`
- `GET /bookings/admin/bookings/:id`
- an admin shopping-list regenerate route
- `POST /bookings`, which always answers 501

Nothing creates, edits or moves a booking's status, and the batch cooker has no "Mes prestations" list.

**Cronofy.** It is configuration only:
- `CronofyService` holds config, and its `baseUrl` builds wrong hosts (`api-cronofy.com`, `api-de-cronofy.com`).
- `ChefProfile.cronofyProfileId` and `Booking.cronofyEventId` are never written.
- No OAuth flow, tokens, free/busy check or calendar event exists.

**Availability.** It exists only as seeded `availability_slots` rows read by the vitrine. The batchcooking-web agenda (`lib/chef/schedule.ts`) models a weekly template plus date exceptions, mock-only.

**Intended outcome:**
1. Bookings segmented by audience, each with GET, POST and PATCH limited to what it may see:
   - client: their own bookings
   - batch cooker: their own bookings, filterable by client
   - admin: every booking on the platform
2. Working hours stored in our database, matching the agenda UI.
3. Cronofy: the batch cooker connects their calendar. Bookings are checked against working hours minus calendar busy time minus other bookings. A confirmed booking appears in the batch cooker's calendar, is updated on reschedule and is deleted on cancel.

**Decisions taken with the user:**
- **Routes:** `/me/bookings`, `/chef/bookings` and `/admin/bookings`. The old `/bookings/*` routes stay as deprecated aliases with unchanged shapes for one release, because the admin console uses them.
- **Creation:** POST creates a `pending` booking, priced on the server, with reference `LF-YYYY-NNNN` and its recipes pinned. No Stripe yet.
- **Status flow:** `pending → confirmed → shopping → cooking → delivered → completed`, plus `cancelled`.
- **Chef-created bookings:** the batch cooker books for a client they already know; the booking is `pending` and the client accepts it.
- **Cronofy scope:** connect the calendar, check availability, push events.
- **Working hours:** stored in our database, with Cronofy busy time subtracted.
- **Data center:** `de` (EU).
- **Tokens:** AES-256-GCM encrypted.

Delivery is in **three phases**, each shippable and testable on its own: A (bookings), then B (availability), then C (Cronofy).

---

## Phase A: role-segmented bookings

### Controllers
- New controller files in `src/modules/bookings/`:
  - `me-bookings.controller.ts`: `@Controller('me/bookings')`, `ClerkAuthGuard`, tag `bookings`.
  - `chef-bookings.controller.ts`: `@Controller('chef/bookings')`, `ClerkAuthGuard`, new tag `chefBookings`. An account with no chef profile gets 404 "No batch cooker profile for this account."
  - `admin-bookings.controller.ts`: `@Controller('admin/bookings')`, `ClerkAuthGuard` and `AdminGuard`, tag `adminBookings`.
- `bookings.controller.ts` keeps its six routes unchanged and adds `deprecated: true` plus "Use `…`" to each. `POST /bookings` keeps answering 501 and points to `POST /me/bookings`. The old service methods (`list`, `listMine`, `getMyBookingDetail`, `getAdminBookingDetail`) and the old DTOs stay until the next release.

### Routes

All `:id` params use `ParseUUIDPipe`. Errors are shaped `{code, message}`. Lists return `{data, meta}` via `resolvePageBounds` and `buildPaginationMeta` (`src/common/dto/pagination.dto.ts`).

| Audience | GET list | GET :id | POST | PATCH :id |
|---|---|---|---|---|
| Client `/me/bookings` | `?status&from&to&page&limit`, newest first | own bookings | `NewBookingDto` | `UpdateBookingDto` |
| Chef `/chef/bookings` | adds `?clientId=`, `startsAt` ascending (agenda) | own bookings | `NewBookingForClientDto` | `UpdateBookingDto` |
| Admin `/admin/bookings` | adds `?clientId&chefId=`, newest first | any booking, client email included | `NewBookingForClientDto` | `AdminUpdateBookingDto` (adds price fields) |

- `POST /admin/bookings/:id/shopping-list/regenerate` uses the same handler as the old route.
- Status changes go through `PATCH` with `status` in the body. There are no separate accept or cancel routes.

### Status rules: `bookings/domain/booking-status.ts`
- Contains one pure function, `canTransition(actor, from, to, requestedBy)`, and exports `GOING_AHEAD = ['confirmed','shopping','cooking','delivered']`.

| Change | Allowed actors |
|---|---|
| `pending → confirmed` | only the side that did **not** propose the current terms (`requested_by`) |
| `pending` or `confirmed → cancelled` | client, chef |
| `confirmed → shopping`, `confirmed → cooking`, `shopping → cooking`, `cooking → delivered` | chef |
| `delivered → completed` | client, chef |
| any change | admin (audited) |

### Service: `bookings.service.ts`
New methods `listFor`, `detailFor`, `create` and `update` each take the role.

**Who is calling:**
- client: `users.ensurePersistedFromClerk`.
- chef: a local `chefOf(clerkId)` helper that copies the `ChefContentService.chef` query. That service isn't exported and pulls in ChefOnboarding.
- admin: `users.findByClerkId`, used for the audit actor.

**Role filter:** `{clientId}`, `{chefProfileId}` or `{}`, spread **last** into every `where`. Anything outside it is 404.

**Create:**
1. `startsAt` must be in the future (422).
2. The offer must be active, from an active and verified chef, and the chef's own offer for chef callers (404 `OFFER_NOT_FOUND`).
3. Chef callers must pass `chefNotVerified` (`dishes/domain/content.errors.ts`), and the client must be known to them: an earlier non-cancelled booking or a `conversation` pair. Otherwise 404 `CLIENT_NOT_FOUND`.
4. Self-booking → 409 `SAME_PERSON`.
5. A formule must be active (422).
6. Meals must be published and belong to that chef or be shared catalog dishes (422). Duplicate meals are rejected in the DTO with `ArrayUnique`.
7. **Availability** (Phase B and later): `availability.assertBookable(chefProfileId, startsAt, endsAt)` → 409 `SLOT_UNAVAILABLE`. Admin calls skip it (support override, audited).
8. Computed values:
   - `endsAt = startsAt + offer.durationMinutes`
   - price = `formule.priceTtc` if given, else `offer.priceCents`; it goes into `priceCents` and `amountTtc`
   - `amountAfterTax = formule?.priceAfterTax`
   - `requestedBy` = `'chef'` for chef callers, else `'client'`
   - nested `bookingMeals.create`
9. The reference is `LF-YYYY-NNNN`, computed as count plus one, retried on P2002 up to 5 times. This gets a `ponytail:` comment: switch to a per-year sequence if it contends.
10. After the commit: `shoppingLists.pinRecipes(id)` runs best-effort. Admin creates write `audit.record('booking.created')`.

**Update:**
1. Load the booking within the role filter.
2. If anything other than `status` changes and the caller is not an admin, the booking must be `pending` (409 `BOOKING_LOCKED`), and `requestedBy` passes to the editor (a counter-proposal).
3. A changed `startsAt` recomputes `endsAt`.
4. `canTransition` is checked against the new `requestedBy`, else 409 `INVALID_TRANSITION`.
5. On `→ confirmed`, the slot check runs again (`availability.assertBookable`, ignoring this booking). This gets a `ponytail:` comment: the check isn't locked, so two simultaneous confirms can both pass.
6. The write is one `$transaction`: replace the meals if sent, plus `booking.update({ where: { id, status: b.status } })`. Prisma `P2025` becomes 409 `CHANGED_MEANWHILE` via `changedMeanwhile` (`dishes/dishes.service.ts:212`).
7. After the commit, all best-effort:
   - meals changed → `shoppingLists.regenerateForBooking`
   - `→ confirmed` → `messaging.ensurePair(clientId, chefProfileId)`
   - admin caller → audit entry
   - calendar sync (Phase C) → `calendar.syncBooking(booking)`

### Views, DTOs and other Phase A edits
- **Views** (`bookings.views.ts`, following the `dishes.views.ts` pattern):
  - **List item** (the "Mes prestations" display):
    - `id, reference, status, requestedBy, startsAt, endsAt, persons, addressLine, notes, shoppingByClient, priceCents, amountTtc, amountAfterTax, currency, createdAt, mealsCount`
    - `client: {id, name, avatarUrl}`. The chef view's name goes through `shortName` (`messaging/domain/messaging.rules.ts:84`); the admin view adds `email`.
    - `chef: {id, displayName}`, `serviceOffer: {id, name}`, `formule: {id, name} | null`
  - **Detail** adds `meals: [{mealId, name, portions, recipeVersion}]`, with no recipe fields (FLOW-02 §8).
- **DTOs** (`dto/bookings.dto.ts`):
  - `BookingsQueryDto` extends `PaginationQueryDto` with `status`, `from` and `to`.
  - `ChefBookingsQueryDto` adds `clientId`, and `AdminBookingsQueryDto` adds `chefId`. Because `forbidNonWhitelisted` is on, other callers get a 400 for these.
  - `NewBookingDto`:
    - `serviceOfferId`, `formuleId?`, `startsAt`
    - `persons?`, `addressLine?`, `notes?`, `shoppingByClient?`
    - `meals?` (≤ 20, unique)
  - `NewBookingForClientDto` adds `clientId`.
  - `UpdateBookingDto = PartialType(OmitType(NewBookingDto, ['serviceOfferId','formuleId']))`, plus `status?`.
  - `AdminUpdateBookingDto` adds the price fields.
- **Prisma:**
  - Add `shopping`, `cooking` and `delivered` to `BookingStatus`. The database already has them from `20250522130000_spec_domain`.
  - Add `requestedBy String? @map("requested_by") @db.VarChar(8)` to `Booking`. NULL is read as `'client'`.
- **Messaging** (`messaging/domain/messaging.rules.ts`):
  - `PairBooking.status` becomes `Exclude<BookingStatus,'cancelled'>`.
  - Contact release uses `GOING_AHEAD`.
  - `isWritable` becomes `status !== 'completed' || endsAt + grace >= now`.
  - Update the comment in `messaging.module.ts`.
- **Wiring:** `bookings.module.ts` registers the four controllers and imports `MessagingModule`, which only imports `UsersModule`, so there is no cycle. `AuditModule` is global.
- **Swagger:** in `common/swagger/tags.ts`, add `chefBookings` and its `TAG_DESCRIPTIONS` entry. In `booking-read.dto.ts`, the Swagger enum gets the new statuses (documentation only).
- **Stale texts to fix:** the `GET /bookings` description, `docs/architecture.md:214`, and the `pinRecipes` comment.

---

## Phase B: working hours and computed availability (no Cronofy needed)

### Prisma
The model mirrors `batchcooking-web/lib/chef/schedule.ts` (`WeeklySlot`, `DateException`). Times are minutes since midnight in Europe/Paris.

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

### Pure domain: `src/modules/calendar/domain/availability.rules.ts`
No date library is added. Only `Intl` is used, as `dishes/domain/vitrine.rules.ts` already does.
- `parisToUtc(dateYmd, minute)`: converts a Paris wall time to a UTC instant. It uses the Intl `shortOffset` two-pass method so it is correct across daylight-saving changes.
- `workingRanges(template, exceptions, from, to)`: the template for each day in the window. A `closed` exception removes the day; an `extra` exception adds a range.
- `subtract(ranges, busy[])` gives the free ranges.
- `startTimes(free, durationMinutes, step = 30)` gives the bookable start instants.

### Service: `calendar/availability.service.ts`
- `getSchedule(chefProfileId)` / `replaceSchedule(chefProfileId, dto)`: deleteMany plus createMany in one transaction.
- `busy(chefProfileId, from, to)` returns:
  - other bookings in `GOING_AHEAD` or `pending` for that chef. Pending bookings also block, so two clients can't request the same slot; cancelled bookings free it.
  - plus Cronofy free/busy (Phase C; empty when not connected).
- `freeSlots(chefProfileId, from, to, durationMinutes)` = `startTimes(subtract(workingRanges, busy))`.
- `assertBookable(chefProfileId, startsAt, endsAt, ignoreBookingId?)`: the range must lie inside a working range and overlap no busy period. Otherwise 409 `SLOT_UNAVAILABLE`.

### Routes
- `GET /chef/availability` and `PUT /chef/availability`: the chef's weekly template and exceptions (`ClerkAuthGuard`, chef lookup, tag `chefBookings` or a new `chefAgenda` tag).
  - `PUT` replaces the whole schedule.
  - Validation: `0 ≤ start < end ≤ 1440`, `weekday` 0–6, no overlapping ranges on the same day, at most 50 exceptions.
- `GET /chef/availability/slots?from&to&durationMinutes`: the chef previews their free time.
- `GET /chefs/:chefId/availability?offerId&from&to`: **public** and throttled, the window capped at 31 days. It returns free start times only, never busy details. Clients use it before `POST /me/bookings`.

### Not included
The vitrine's `slotsLeft` still reads `availability_slots`. Switching it to `freeSlots` is a follow-up; this gets a `ponytail:` comment in `vitrine.service.ts`.

---

## Phase C: Cronofy (connect, free/busy, events), data center `de`

### Config and fix
- In `config.loader.ts` and `env.validation.ts`:
  - `CRONOFY_DATA_CENTER` is validated as one of `us`, `uk`, `de`, `au`, `ca`, `sg`.
  - Add `CRONOFY_REDIRECT_URI`, the batchcooking-web callback page, e.g. `https://batchcooking.labsfood.fr/espace-chef/agenda/cronofy`.
  - Add `CRONOFY_TOKEN_KEY` (32 bytes, base64).
  - All stay optional. Without them, the calendar routes answer 503 `CALENDAR_UNAVAILABLE`, following the R2 pattern.
- **Fix `CronofyService`:**
  - `apiUrl` = `https://api.cronofy.com` for `us`, else `https://api-{dc}.cronofy.com`
  - `appUrl` = `https://app.cronofy.com` for `us`, else `https://app-{dc}.cronofy.com`
  - Update `cronofy.service.spec.ts`, which asserts the wrong hosts today.
- **Railway** (you set these, or I do on request): `CRONOFY_DATA_CENTER=de`, `CRONOFY_CLIENT_ID`, `CRONOFY_CLIENT_SECRET`, `CRONOFY_REDIRECT_URI` and `CRONOFY_TOKEN_KEY` on develop, then staging and production. The Cronofy application must be created in the **de** data center.

### API client: `src/integrations/cronofy.service.ts`
- Stateless, native `fetch` (the Brevo pattern), no SDK.
- Methods:
  - `authorizeUrl(state)`: `{appUrl}/oauth/authorize`
  - `exchangeCode(code)` and `refresh(refreshToken)`: `POST {apiUrl}/oauth/token`
  - `revoke(token)`: `POST /oauth/token/revoke`
  - `listCalendars(accessToken)`: `GET /v1/calendars`
  - `freeBusy(accessToken, from, to)`: `GET /v1/free_busy`, following `pages.next_page`
  - `upsertEvent(accessToken, calendarId, event)`: `POST /v1/calendars/{id}/events`. `event_id` is our booking id, so it is idempotent.
  - `deleteEvent(accessToken, calendarId, eventId)`
- Scopes: `read_account list_calendars read_free_busy create_event delete_event`. **Check the scope names and the free/busy window limit against the Cronofy docs before coding.**

### Token encryption: `src/common/crypto/secret-box.ts`
- `seal(plain, key)` / `open(sealed, key)`: AES-256-GCM with a random 12-byte IV, stored as `v1.<iv>.<tag>.<ciphertext>` (base64url).
- Comes with a round-trip and tamper test.

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
`ChefProfile.cronofyProfileId` gets the linked profile id, so the existing column now has a meaning. `Booking.cronofyEventId` is set once the event has been pushed.

### Calendar module: `src/modules/calendar/`
- `calendar.module.ts` holds:
  - `AvailabilityService` (Phase B)
  - `CalendarConnectionService`
  - `ChefCalendarController`, `ChefAvailabilityController`, `PublicAvailabilityController`
- It exports `AvailabilityService` and `CalendarConnectionService`. BookingsModule imports CalendarModule; CalendarModule never imports BookingsModule (it reads `prisma.booking` directly), so there is no cycle.
- **OAuth flow:** there is no public backend callback, so no state-to-session problem.
  1. `GET /chef/calendar/connect-url` returns `{url}`. The `state` is an HMAC-signed `chefProfileId.expiry.nonce` (`createHmac` with `CRONOFY_TOKEN_KEY`, valid 10 min).
  2. Cronofy redirects to `CRONOFY_REDIRECT_URI` (the batchcooking-web page) with `code` and `state`.
  3. That page calls `POST /chef/calendar/connect {code, state}` with the Clerk token. The backend checks that the HMAC is valid, the state hasn't expired, and the state's chef is the caller's chef, then:
     - exchanges the code
     - seals the tokens
     - upserts the connection
     - sets `cronofyProfileId`
     - picks the primary or first writable calendar as `calendarId`
- **Other routes:**
  - `GET /chef/calendar`: `{connected, status, providerName, profileName, calendarId, calendars[]}`.
  - `PATCH /chef/calendar {calendarId}`: the calendar must be in `listCalendars`.
  - `DELETE /chef/calendar`: revokes (best-effort) and deletes the connection.
- **`accessToken(conn)`:** refreshes when the token expires within 60 s, and retries once after a 401.
  - On `invalid_grant`, it sets `status='revoked'`. The chef sees "reconnect", and availability falls back to working hours minus bookings (logged).
  - This gets a `ponytail:` comment: no lock on concurrent refreshes.

### Booking integration
- **`AvailabilityService.busy`** adds `cronofy.freeBusy` for an active connection (statuses `busy` and `tentative`).
  - If Cronofy errors, it logs and continues without calendar busy time, so the booking isn't blocked.
  - This gets a `ponytail:` comment: no cache; a short Redis cache if latency matters (Redis is already global).
- **`calendar.syncBooking(booking)`** is called best-effort after every booking commit:

| Booking change | Calendar action |
|---|---|
| status in `GOING_AHEAD` and the chef is connected | `upsertEvent` (summary "Prestation LF-…", client short name, address, start and end), then `cronofyEventId = booking.id` |
| `cancelled`, with `cronofyEventId` set | `deleteEvent` |
| admin edit of a confirmed booking's time | `upsertEvent` |

  - Failures are logged. This gets a `ponytail:` comment: no retry queue; add a BullMQ or Redis retry if sync failures show up in the logs.
- **Not included (add when needed):** Cronofy push-notification channels and webhooks, because free/busy is queried live. Also client-side calendar invites and Cronofy Element UI.

### Frontend dependency (batchcooking-web; I don't touch it unless you ask)
The batchcooking-web side needs:
- a callback page at `CRONOFY_REDIRECT_URI` that posts `code` and `state`
- the agenda wired to `GET/PUT /chef/availability`
- the booking page wired to `GET /chefs/:id/availability`
- "Mes prestations" wired to `GET /chef/bookings`

---

## Migrations (written only, never applied by me)
- `20261012120000_booking_flow`:
  - `ALTER TYPE booking_status ADD VALUE IF NOT EXISTS` for `shopping`, `cooking` and `delivered`
  - `ALTER TABLE bookings ADD COLUMN IF NOT EXISTS requested_by VARCHAR(8) CHECK (requested_by IN ('client','chef'))`
- `20261012130000_chef_availability`: `chef_working_hours` and `chef_availability_exceptions` with FKs, the checks `start_minute < end_minute` and `weekday BETWEEN 0 AND 6`, and indexes.
- `20261012140000_chef_calendar_connections`: the table with a unique `chef_profile_id` and an FK with cascade.

## Files
- **Phase A:**
  - new: `bookings/me-bookings.controller.ts`, `chef-bookings.controller.ts`, `admin-bookings.controller.ts`, `bookings.views.ts`, `dto/bookings.dto.ts`, `domain/booking-status.ts` and its spec
  - modified: `bookings.service.ts`, `bookings.controller.ts`, `bookings.module.ts`, both bookings specs, `messaging/domain/messaging.rules.ts` and its spec, `common/swagger/tags.ts`, `prisma/schema.prisma`
- **Phase B:** new `src/modules/calendar/`:
  - `calendar.module.ts`, `availability.service.ts`
  - `chef-availability.controller.ts`, `public-availability.controller.ts`
  - `domain/availability.rules.ts` and its spec, `dto/availability.dto.ts`
  - plus registration in `app.module.ts`
- **Phase C:**
  - new: `calendar/calendar-connection.service.ts`, `calendar/chef-calendar.controller.ts`, `common/crypto/secret-box.ts` and its spec
  - modified: `integrations/cronofy.service.ts` and its spec, `config/config.loader.ts`, `config/env.validation.ts`, both `.env.example` files, `docs/deploy/railway.md`

## Assumptions to confirm
1. The new `requested_by` column, which tells the server who must accept a pending booking.
2. The formule price **replaces** the offer price.
3. An admin can set any status, and admin-created bookings skip the availability check (both audited).
4. Either side can close `delivered → completed`.
5. Pending bookings block the slot, so two clients can't request the same time.
6. The public availability endpoint needs no login (the vitrine is public).
7. Slot step is 30 min, availability window at most 31 days, timezone Europe/Paris.

## Verification
```
cd apps && npm ci                                   # local deps are missing (@nestjs/platform-ws, websockets)
npx prisma generate && npx prisma validate          # SUPABASE_DB_URL must be set; no DB is contacted
npx jest src/modules/bookings src/modules/calendar src/modules/messaging src/common/crypto src/integrations
npx tsc --noEmit && npm run lint && npm test
```

**Phase A tests:**
- `booking-status.spec.ts`: an `it.each` table of allowed and refused changes.
- Service spec:
  - price from the offer and from the formule; `endsAt` from the offer duration
  - reference `LF-YYYY-0001`, and a retry after P2002
  - `pinRecipes` called after create
  - `SAME_PERSON`; a chef booking for an unknown client → 404
  - `BOOKING_LOCKED`, `INVALID_TRANSITION`, `CHANGED_MEANWHILE`
  - `ensurePair` called on confirm
  - the client list `where` keeps `clientId`
- Controller spec: `/admin/bookings` → 403 for client and chef, 200 for admin; a bad UUID → 400. The existing `GET /bookings` tests stay.
- Messaging rules: in-progress statuses behave like `confirmed`.

**Phase B tests:** `availability.rules.spec.ts`:
- daylight-saving changes (the last Sunday of March and of October)
- a `closed` exception removes the day; an `extra` exception adds a range
- subtracting busy time, and start times that exactly fill a gap
- `assertBookable` rejects outside working hours and on overlap

**Phase C tests:**
- `secret-box.spec.ts`: round trip; tampered data is rejected.
- `cronofy.service.spec.ts`: `de` gives `api-de.cronofy.com` and `app-de.cronofy.com`; `us` gives `api.cronofy.com`.
- Connection service, with `fetch` mocked: the signed state is rejected when expired, tampered or for another chef; a token near expiry is refreshed; `invalid_grant` marks the connection revoked.
- `syncBooking` upserts on confirm and deletes on cancel; a Cronofy failure doesn't fail the booking.

**Manual end-to-end on develop** (after deploy and the env variables are set):
1. Connect a test Google calendar via `connect-url`.
2. Check that `GET /chefs/:id/availability` hides a busy calendar block.
3. Create and confirm a booking, and see the event appear.
4. Cancel it, and see the event disappear.

## First step (as you asked): branch and commit this plan
1. From a clean `develop`, run `git checkout -b feat/bookings-roles-cronofy`.
2. Copy this plan into the repo as `.claude/plans/bookings-roles-cronofy.plan.md`. That folder is already tracked and uses the `*.plan.md` naming.
3. Commit only that file, with the message `docs(plans): role-segmented bookings, chef availability and Cronofy`. The commit has no AI or tool attribution.
4. No push until you ask.

Implementation (Phases A → C) starts only after you say so, on that branch.

No DB writes, no migration applied, no commit or push without an explicit request.
