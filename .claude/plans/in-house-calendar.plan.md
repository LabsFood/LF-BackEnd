# In-house batch cooker calendar

> **Revision 3, 2026-10-15.** Revision 2 plus your answers:
> - booking defaults to the most expensive offer
> - `slotsLeft` counts sessions of the shortest offer
> - `calendarConnected` means the feed is in use
> - batch cookers may counter-propose a closed day
> - a temporary `disputed` status (Phase S)
>
> Every assumption is decided, rescheduling included (48 h ahead, 48 h to confirm).
>
> Revision 2 was cross-checked against batchcooking-web at `480b230` (read-only), and written to
> the standing rule: every phase ships its error handling and its logs, ready for Datadog or any
> other aggregator. Revision 1 was committed in `31d3c87`.
>
> Builds on Phase B of [`bookings-roles-cronofy.plan.md`](./bookings-roles-cronofy.plan.md):
> working hours, free slots and `assertBookable` already exist in `modules/calendar/`.

## Context

**Decision:** the calendar is ours. No third-party calendar provider: nothing to link, no tokens to keep, no outside busy time. The batch cooker's time is what we know: working hours, bookings and the blocks they set themselves.

**What exists** (on `feat/bookings-roles-cronofy`):
- `GET/PUT /chef/availability`: weekly template plus dated exceptions (`closed` day, `extra` range).
- `GET /chef/availability/slots` and the public `GET /chefs/:id/availability?offerId&from&to`.
- `AvailabilityService.assertBookable`, checked on every booking made or moved by a client or batch cooker.
- Bookings hold the slot from `pending` on; an unpaid one is freed after 72 h.
- Cronofy: the service, its spec and its registration are gone (`d396d54`). Its settings remain (Phase 0).

**Chosen scope:**
1. One agenda endpoint.
2. A calendar feed (`.ics`).
3. Rescheduling a confirmed booking.
4. No access to the batch cooker's other calendars: manual blocks only.

---

## Cross-check against the batchcooking-web agenda

**Sources read:**
- the agenda page `app/espace-chef/agenda/page.tsx` and its model `lib/chef/schedule.ts`
- the chef dashboard, the public menu browser and the client reservation and booking pages
- the web API conventions (`docs/api/README.md`), FLOW-02 §5.1, `PLAN-dashboards-v2.md` and the pilotage backlog

The agenda page still runs on mocks. Its backlog item **LF-0074 "Brancher les disponibilités"** (due 2026-10-24, endpoint "à définir") is what Phase D1 unblocks.

| # | What the screen needs | Where | Revision 1 | Revision 2 |
|---|---|---|---|---|
| 1 | Day, week, month and year views over the same data | `agenda/page.tsx` 34, 181–196 | a window of 31 days at most | **42 days**: the month grid is six full weeks |
| 2 | Year view: prestations per month | `YearView` 467–499 | not covered | **`GET /chef/agenda/summary?year=`** |
| 3 | Working-hour bands; weekly ones marked "hebdo", extra ones removable by id | `DayPanel` 592–610 | computed `working` spans, without ids | the agenda returns the **schedule itself** (weekly slots and exceptions **with ids**); the page already turns it into bands (`workingRanges` in `schedule.ts`) |
| 4 | Edit the weekly template and a single day, click by click | `WeeklyHoursEditor`, `DayPanel` | `PUT` of the whole schedule | kept, plus **ids** and a **`version`**: a stale second tab gets 409 `SCHEDULE_CHANGED` instead of erasing the first one's edits |
| 5 | A closed day has no hours at all: closing drops the day's extras | `schedule.ts` `workingRanges`; page 208, 218 | the backend still added extras to a closed day | **a closed day wins**; a date both closed and with an extra range is refused (422 `SCHEDULE_CONFLICT`) |
| 6 | "Vous ne recevrez aucune demande pour cette date" on a closed day | page 584 | requests not checked | a custom request sent to that batch cooker for a closed date is refused (409 `CHEF_CLOSED_ON_DATE`). The batch cooker may still **propose** a closed date in an offer, as a counter-proposal |
| 7 | Overlapping ranges can be added in the page | `WeeklyHoursEditor` 658–664 | 422 without saying where | 422 `SCHEDULE_OVERLAP` with `details: {weekday}` or `{date}`, so the page can point at the day |
| 8 | Prestation events: client name, **city**, time, status badge | page 61–72, `MissionBadge` | short name and the free-text address | **`city`**: two new booking columns, `address_city` and `address_postal_code` |
| 9 | Request events "Demande à confirmer": client name, city, time | page 74–85 | id, reference, title, persons, window | adds the client's short name and the city; the time comes from the **active offer's proposed date** when it moved; a `stage`: `to_answer` or `offer_sent` |
| 10 | Clicking an event opens the day | page 373 | covered | the booking `id` lets the page deep-link to the prestation |
| 11 | "Zone d'intervention" card | page 230–238 | covered | `GET /me/profile` already returns it |
| 12 | Dashboard: next prestation (dishes, net), upcoming count, "Mes disponibilités" link | `espace-chef/page.tsx` 91–149, 227 | covered | `GET /chef/bookings?from=<now>` (earliest first) plus its detail; no change |
| 13 | Public menu: "N créneaux libres", "Complet cette semaine", "Sur demande" | `ChefMenuBrowser.tsx` 278–281; FLOW-02 §5.1 | still read the seeded `availability_slots` | **`slotsLeft` computed from the agenda**, in whole sessions of the shortest active offer (D1b) |
| 14 | Client booking: a date, then a time | `espace-client/reservation/page.tsx` 276–289 | public slots need an `offerId`, but the flow knows the chef and dishes, never an offer | `offerId` **optional**: it defaults to the chef's **most expensive** active offer, and the answer names that `offer` so the page can book it and show its price (D1b) |
| 15 | Client "Demander une annulation" | `commandes/[id]/page.tsx` 272 | `PATCH` cancels an unpaid booking, 409 `BOOKING_PAID` once paid | no change: on `BOOKING_PAID` the page opens the support thread (`POST /me/conversations/support`) |
| 16 | Chef space read-only before approval | REVIEW-01 §2.5 | every `/chef/*` route answers 403 `CHEF_NOT_VERIFIED` | no change; the page shows its "dossier en cours" state |
| 17 | The web client reads `body.code` | `lib/api/client.ts` `ApiError` | every refusal has a stable `code` | error bodies also carry the **`requestId`** (Phase L), so support can find the log line |
| 18 | Agenda sync is P2, lot 6 | `PLAN-dashboards-v2.md` §4 | feed in D2 | D2 is that sync; it comes after D1 |
| 19 | Rescheduling | no screen yet | D3 | D3 stays last; it is ahead of the UI |
| 20 | Prestation badge "En litige", in the history tab | `states.ts` 222, `prestations/page.tsx` 66 | no backend status | a **temporary `disputed` status** (Phase S), until the litiges module exists |

**Seen on the way, outside the agenda (not planned here):**
- The reservation page computes its own price (extra dishes 8 €, extra persons 15 €). The API prices from the offer or the formule only.
- `docs/api/README.md` describes `?page&perPage` with `{items, page, perPage, total}`. The backend answers `?page&limit` with `{data, meta}`.
- The same README asks for an `Idempotency-Key` header on creations. No route implements it. In this plan, double clicks are absorbed instead by:
  - the slot a pending booking holds
  - the single open reschedule proposal
  - an identical block being returned rather than created twice

---

## Phase L: error handling and logging, for every phase below

**What exists:**
- Fastify's pino access logs, with a request id that honours an inbound `x-request-id` and is sent back on every response.
- Nest's `ConsoleLogger` in JSON when `LOG_JSON` (production).
- `AuditService` rows carrying `requestId`.

**What's missing:**
- The request id on Nest's own log lines.
- A single place where errors are logged.
- The fields an aggregator facets on.

### L1. Request context
- An `AsyncLocalStorage` (`common/logging/request-context.ts`), filled in the existing `onRequest` hook in `main.ts`.
- It holds `requestId`, `method` and `route`. `ClerkAuthGuard` adds the Clerk user id: an opaque id, not personal data.

### L2. One logger, structured
- `AppLogger` (`common/logging/app-logger.ts`) extends `ConsoleLogger`. In JSON mode it adds, to every line:
  - `requestId`, `userId`
  - `service: 'lf-api'`, `env` (`ENVIRONMENT`), `version` (`RAILWAY_GIT_COMMIT_SHA`)
- Datadog reads `service`, `env` and `version` as its reserved attributes.
- Business events are logged as objects, one event per line, with a dotted name, for example `logger.log({ event: 'booking.created', bookingId, chefProfileId, ms })`.
- No dependency added.

### L3. One exception filter
`AllExceptionsFilter` (`common/logging/all-exceptions.filter.ts`), registered in `main.ts`.

| What failed | Log level | Logged with |
|---|---|---|
| Unexpected error (5xx) | `error` | stack, `code`, route, `requestId` |
| Business refusal, 409 or 422 | `warn` | `code`, route, status. Refusal rates (`SLOT_UNAVAILABLE`, `BOOKING_PAID`) can be graphed. |
| 400, 401, 403, 404 | `debug` | `code`, route |

- The body is unchanged except for an added `requestId`. It's additive, so the admin console is unaffected. An unknown error answers 500 `{code: 'INTERNAL', message, requestId}`, never a stack.
- Prisma `P2002` and `P2025` keep being mapped where they happen (`changedMeanwhile`, the reference retry).

### L4. Rules every phase follows
- Every refusal is an `HttpException` with a stable `code`, listed in the phase's table and in Swagger.
- Best-effort side effects catch, log at `error` with the ids, and never fail the request. Examples: emails, the shopping list, recipe pinning.
- Jobs log one summary line per run (`event`, counts, `ms`), and failures with the stack.
- **Never logged:** names, emails, phone numbers, addresses, notes, tokens, feed URLs. Only ids, codes, counts and durations.

### L5. Shipping logs (not built now)
- A Railway log drain or a Datadog agent, plus `DD_SERVICE`, `DD_ENV` and `DD_VERSION` on Railway when it's set up.
- APM (`dd-trace`) later would add trace ids to the same lines.

### L6. Retrofitting Phases A and B
These were written before the rule. They gain events:
- bookings: `booking.created`, `booking.updated` (with `from` / `to`), `booking.cancelled`, `booking.expired`, `booking.hold_reminded`
- `availability.refused` (with `chefProfileId`)
- `cesu.proof_uploaded` and `cesu.proof_replaced`
- `booking.photo_added` and `booking.photo_removed`
- `schedule.replaced` (with range counts)

**Tests:**
- The filter keeps the body and adds `requestId`; a 5xx answer carries no stack.
- A line written inside a request carries its `requestId`.
- No log line in the booking and CESU specs contains the client's email or address (checked on captured output).

---

## Phase 0: remove what remains of Cronofy

Already done in `d396d54`: the service, its spec, its registration.

**Left:**
- the `cronofy` block in `config.loader.ts` and its test in `config.loader.spec.ts`
- `CRONOFY_*` in `env.validation.ts`, `local-dev/.env.example` and `local-dev/docker-compose.yml`
- the rows in `docs/deploy/railway.md` and `docs/architecture.md` (lines 48 and 261)
- one line in `docs/auth/clerk-supabase-sync.md` (line 123): a deletion candidate, your call

**`GET /admin/chefs/:id` sends `calendarConnected`**, computed from the Cronofy column. It is now always `false`, and the admin console reads it, so **the key stays**. **Decided:** it means the batch cooker syncs their calendar app (Google, Outlook, Apple…) with our feed. D2 computes it; until then it stays `false`.

**Kept:**
- the columns `chef_profiles.cronofy_profile_id` and `bookings.cronofy_event_id`, unused
- `PATCH /me/chef-profile` still refusing `cronofyProfileId`

Railway: nothing to remove.

---

## Phase S: a temporary `disputed` status

**What the front has:**
- the badge "En litige" (`MissionStatus` `disputed`), shown in the history tab next to `done`
- FLOW-03 §3: an open dispute blocks payment with 409 `BOOKING_DISPUTED`

The litiges module (BC-13: categories, attachments, Ouvert → En traitement → Résolu) doesn't exist yet. Until it does, `disputed` is a booking status only.

### Rules
- **Who sets it:** an admin only, through `PATCH /admin/bookings/:id {status: 'disputed'}`, from any status except `cancelled`. Admin moves are already allowed and audited, so `canTransition` is unchanged.
  - A client or batch cooker reports a problem through the support thread (`POST /me/conversations/support`), and the admin sets the status.
  - Their PATCH DTOs don't list `disputed`, so they get a 400.
- **Leaving it:** an admin only.
  - To `completed`: resolved, nothing refunded.
  - To `cancelled`: refunded by hand in Stripe for card payments, as for any paid booking an admin cancels.
- **Payment:** `assertPayable` refuses a disputed booking with 409 `BOOKING_DISPUTED`. All four payment routes go through it:
  - the card intent
  - the URSSAF settle
  - the CESU declaration
  - the e-CESU proof upload
- **Payment status:** `GET /me/bookings/:id/payment-status` keeps its five states, which the web types list. It answers `not-due` for a disputed booking; the page reads the booking's `status` first.
- **What does not change:**
  - The thread stays writable for as long as the dispute is open; `isWritable` already does this for any status other than `delivered` or `completed`.
  - Contacts stay masked; the release window closed when the prestation ended.
  - Photos can still be added: they are evidence. `disputed` joins `STARTED` in `booking-photos.service.ts`.
  - The client's recipe sheet stays `completed`-only (`missions.service.ts`). It is handed over when the dispute is resolved to `completed`.
  - The vitrine's "prestations réalisées" count stays `completed`-only.
  - The agenda, its summary and the feed show it like any non-cancelled booking.
- **Not included:** pausing the commission debit of a disputed booking paid in the direct circuit (CESU, URSSAF). The litiges module decides that.

### Why "temporary" stays in the database
Postgres can't drop an enum value without recreating the type. So when the litiges module ships, the value stays and the module drives it:
- opening a dispute sets `disputed`
- resolving one sets `completed` or `cancelled`

The temporary part is who sets it: an admin today, the module later.

### Code
- `schema.prisma` `BookingStatus` gains `disputed`.
- Migration `20261015110000_booking_status_disputed`: `ALTER TYPE "booking_status" ADD VALUE IF NOT EXISTS 'disputed';`, as `20250522130000_spec_domain` did for `shopping`.
- `BOOKING_STATUSES` in `domain/booking-status.ts` and the Swagger enum in `booking-read.dto.ts` list it.
- `paymentPhase` gains a `disputed` phase; `assertPayable` maps it to 409.
- **Admin console:** `/admin/bookings` and `/bookings` can now answer `status: 'disputed'`. The shape is unchanged, but it's a value the console has never seen. Check that it shows an unknown status rather than breaking.

### Errors and logs
- `BOOKING_DISPUTED` (409) on the payment routes. `INVALID_TRANSITION` is unchanged.
- `booking.updated` (L6), with `from` and `to`, covers opening and closing a dispute. The audit row names the admin.
- The global filter (L3) logs each `BOOKING_DISPUTED` refusal at `warn` with its route, so refusals during disputes can be counted. No extra event.

### Tests
- `canTransition`: the client and batch cooker can't move to or from `disputed`; an admin can.
- `assertPayable`: `disputed` gives 409 `BOOKING_DISPUTED`. The four payment routes refuse it (one case each in the existing specs).
- Photos are accepted on a disputed booking.
- `isWritable` stays true for a disputed booking long past its end.

---

## Phase D1: the agenda, fitted to the page

### Schema (migration `20261015120000_agenda`)
- `ChefTimeBlock` (`chef_time_blocks`):
  - fields: `id`, `chefProfileId` (FK, cascade), `startsAt`, `endsAt`, `reason` (255), `createdAt`
  - index `(chef_profile_id, starts_at)`
  - `CHECK (starts_at < ends_at)`
- `bookings.address_city VARCHAR(120)` and `bookings.address_postal_code VARCHAR(16)`, nullable.
  - Backfilled in the same migration from the quote of quote-born bookings: `UPDATE … FROM quotes WHERE quotes.booking_id = bookings.id`.
  - Filled from now on by quote acceptance, and by `POST /me|chef|admin/bookings` (new optional DTO fields `addressCity` and `addressPostalCode`).
  - The booking views add `city`.

### Working hours (`/chef/availability`), fitted to how the page edits
- Every weekly slot and exception carries its `id`.
- `GET` and `PUT` answer a `version`: a hash of the saved schedule, with no new column.
  - `PUT` accepts `version`. A mismatch is 409 `SCHEDULE_CHANGED`, and the page reloads.
  - Without `version`, no check, as today.
- **A closed day wins:** `workingSpans` ignores the day's extras. A `PUT` with a date both closed and extra is 422 `SCHEDULE_CONFLICT`.
- Refusals name the place: 422 `SCHEDULE_OVERLAP` with `details: {weekday}` or `{date}`, and 422 `RANGE_INVALID` (end not after start).

### Closed days stop requests, not counter-proposals
A closed day is never shown as available, so a request for it is refused by default. Only a whole closed day is checked, not hours: a request is a half-day the batch cooker answers.

`AvailabilityService.isClosed(chefProfileId, date)` is used by:
- `POST /quotes` with a `chefProfileId` and a `desiredDate`
- an admin assigning a batch cooker (`PATCH /admin/quotes/:id`): the page promises "Vous ne recevrez aucune demande pour cette date"

Both answer 409 `CHEF_CLOSED_ON_DATE`.

**An offer may propose a closed day.** It is the batch cooker's own counter-proposal, so offers are not checked. Accepting such an offer creates the booking as today: quote acceptance doesn't run `assertBookable`.

### Routes (tag `chefBookings`, `ClerkAuthGuard`, approved batch cooker)
- `GET /chef/agenda?from&to`, **42 days at most**:
  - `schedule`: `{weekly, exceptions, version}`, the same shape as `GET /chef/availability`, with only the exceptions in the window; and `scheduled`
  - `prestations`: every booking except cancelled ones, overlapping the window
    - `id, reference, status, startsAt, endsAt, timeSlot, persons, city`
    - `client: {name}`, the first name and initial
    - (D3) `rescheduleTo`, the proposed start while a proposal is open
  - `requests`: requests assigned to this batch cooker
    - `stage: 'to_answer'` for statuses `submitted`, `in_review` and `declined` (the client refused the last offer; another can be sent)
    - `stage: 'offer_sent'` for `quoted`
    - fields: `id, reference, title, persons, city`, `client: {name}`, and `startsAt` / `endsAt`
    - the time is the active offer's `proposedDate` and `proposedTimeSlot` when set, else `desiredDate` and `timeSlot`, through `slotWindow`; `null` when the client gave no date
  - `blocks`: `id, startsAt, endsAt, reason`
- `GET /chef/agenda/summary?year=YYYY`: `{year, months: [{month, prestations}]}`, non-cancelled bookings by Paris month of their start.
  - `ponytail:` counted in memory from one query for the year. A batch cooker has hundreds of bookings a year at most; switch to a SQL `date_trunc` if that grows.
- `POST /chef/agenda/blocks` `{startsAt, endsAt, reason?}` and `DELETE /chef/agenda/blocks/:id`.
  - The same start and end twice returns the existing block, absorbing a double click.
  - The block counts as busy for free slots and `assertBookable`.

### Errors
| Code | Status | When |
|---|---|---|
| `VALIDATION_FAILED` | 422 | window empty, past or over 42 days; bad `year` |
| `RANGE_INVALID`, `SCHEDULE_OVERLAP`, `SCHEDULE_CONFLICT` | 422 | schedule `PUT`, with `details` |
| `SCHEDULE_CHANGED` | 409 | stale `version` |
| `BLOCK_OVERLAPS_BOOKING` | 409 | a booking still holds that time: cancel it first |
| `TOO_MANY_BLOCKS` | 409 | 200 blocks ahead |
| `BLOCK_NOT_FOUND` | 404 | someone else's block or none |
| `CHEF_CLOSED_ON_DATE` | 409 | a request sent, or a batch cooker assigned, on a closed day |
| `NOT_A_CHEF` / `CHEF_NOT_VERIFIED` | 404 / 403 | as on every `/chef/*` route |

### Logs
- `agenda.read` at `debug`: `chefProfileId`, `days`, counts per kind, `ms`.
- `schedule.replaced`: `chefProfileId`, weekly and exception counts.
- `block.created` and `block.deleted`: `chefProfileId`, `blockId`. The reason is never logged; the batch cooker typed it.
- `availability.refused`: `chefProfileId`, `code`.

### Tests
- **Agenda:**
  - cancelled bookings are left out
  - a request shows at its offer's proposed time
  - a request without a date has no window
  - `to_answer` versus `offer_sent`
  - nothing from another batch cooker
  - 43 days refused
- **Summary:** a booking at 23:30 on 31 March Paris time counts in March, not April.
- **Schedule:** ids returned; stale `version` gives 409; closed with extra on one date gives 422; `details` names the overlapping day.
- **Blocks:** overlap with a booking refused; a double click returns one block; a block removes its slots from `freeSlots`; `assertBookable` refuses inside a block.
- **Requests:** a quote on a closed day gives 409, and so does an admin assignment; an offer proposing a closed day is accepted, and so is its acceptance.

---

## Phase D1b: what clients see

### Public availability without an offer id
- `GET /chefs/:id/availability?from&to[&offerId]`: without `offerId`, the chef's **most expensive active offer** is used.
  - `ORDER BY price_cents DESC, duration_minutes ASC, created_at ASC`: a tie on price goes to the shorter session, then the older offer.
  - The menu card's "à partir de" (`sessionFromCents`) still shows the cheapest offer; the reservation page shows the returned `offer.priceCents`.
- The answer adds `offer: {id, name, durationMinutes, priceCents}`, so the reservation page can call `POST /me/bookings` with `serviceOfferId`.
- No active offer: 404 `OFFER_NOT_FOUND`, and the page shows "sur demande".

### `slotsLeft` from the agenda (FLOW-02 §5.1)
- On `GET /menus/week` and `GET /chefs/:id`: the number of **whole sessions** that fit in the batch cooker's free time that week, the sum of `floor(free span / duration)`.
  - The session length is the batch cooker's **shortest active offer**: with a 2 h 30 offer, a 5 h free afternoon counts as 2. Sessions average 3 h.
  - Only whole sessions count: 4 h free with a 2 h 30 offer counts as 1.
  - The card can show more créneaux than the reservation page offers start times, since that page books the most expensive offer, which may be longer. Accepted.
  - `null` when no working hours are set, or no active offer ("Sur demande").
  - `0` drops the card from the week, as today ("Complet").
- Batched: one query each for working hours, exceptions, blocks and bookings, for every batch cooker on the page, then computed in memory (`AvailabilityService.slotsLeftFor(chefIds, week)`). `DishesModule` imports `CalendarModule`; no cycle.
- `availability_slots` stops being read. The table stays; dropping it is a separate decision.

### Errors and logs
- Codes: `OFFER_NOT_FOUND` (404), `VALIDATION_FAILED` (422, window).
- Logs:
  - `availability.public_read` at `debug`, with `chefProfileId` and `ms`; it is public and throttled, so not at `info`
  - `vitrine.slots_computed` at `debug`, with `chefs` and `ms`

### Tests
- Without `offerId`, the most expensive offer is used and named; on equal prices, the shorter one.
- `slotsLeft` is `null` without hours or without an offer, and `0` when bookings and blocks fill the week.
- It uses the shortest offer: 5 h free with offers of 2 h 30 and 4 h gives 2. It counts whole sessions only: 4 h free gives 1.
- The batched query count doesn't grow with the number of batch cookers.

---

## Phase D2: the calendar feed (`.ics`), P2 on the web plan

Unchanged from revision 1:
- a private subscribe link per batch cooker (only its SHA-256 stored, rotate or turn off)
- the public, throttled `GET /calendar/feed/:token.ics`
- `GET /me/bookings/:id/calendar.ics` for the client
- `calendar/domain/ics.ts` (folding, escaping, UTC)
- migration `20261015130000_chef_calendar_feeds`

**New: `calendarConnected` comes from the feed.**
- `chef_calendar_feeds` gains `last_fetched_at TIMESTAMPTZ(6)`.
  - It is written when the feed is served, at most once an hour: `updateMany` where it is null or older than an hour.
  - Calendar apps poll every few hours, so this is a few writes a day per batch cooker.
- `GET /admin/chefs/:id`: `calendarConnected` is true when the feed is turned on and was fetched in the last **7 days**.
  - A calendar that unsubscribed stops polling, so the flag drops on its own after a week.
  - Rotating or turning off the link resets `last_fetched_at`.
  - The key and its type are unchanged for the admin console.
- `GET /chef/calendar-feed` adds `lastFetchedAt`, so the batch cooker sees "synchronisé il y a 2 h".
- `ponytail:` any fetch counts, including a one-off download from a browser. Filter on the `User-Agent` if the admin flag misleads.

**Errors:**
- `FEED_NOT_FOUND` (404): unknown token or turned-off feed, with no hint which.
- `BOOKING_NOT_FOUND` (404) on the client file.

**Logs:**
- `feed.created`, `feed.rotated`, `feed.disabled`: `chefProfileId`.
- `feed.served` at `debug`: `chefProfileId`, `events`, `ms`.
- `feed.unknown_token` at `warn`: the client IP only, **never the token**. A burst means someone is guessing.

**Tests (new):** `calendarConnected` is false before the first fetch, true after it, and false again after 7 days, a rotation or turning the feed off. Two fetches within an hour write once.

---

## Phase D3: rescheduling a confirmed booking (no screen yet)

As revision 1, with the 48 h rule you set. The rules:
- Either side proposes; the other confirms.
- Only a `confirmed` booking.
- Nothing moves inside the last **48 h**, the same J-2 at which contacts are released:
  - the current start must be more than 48 h away, when proposing and when confirming
  - the new start too
- **48 h to confirm.** A proposal expires 48 h after it is made, or 48 h before the current start, whichever comes first.
  - A proposal made 60 h ahead therefore has 12 h.
  - The booking detail shows `expiresAt`, so the screen can say so.
- One open proposal per booking, through a partial unique index.
- The time is checked against availability when proposed and when confirmed, and is not held meanwhile.
- Two Brevo emails, whose ids go on Railway.

Migration `20261015140000_booking_reschedules`. The agenda's `rescheduleTo` comes from here.

**Errors:** `BOOKING_NOT_RESCHEDULABLE` (not `confirmed`, or either start within 48 h), `RESCHEDULE_PENDING`, `RESCHEDULE_NOT_FOUND`, `RESCHEDULE_OWN_PROPOSAL`, `RESCHEDULE_EXPIRED` (confirmed after `expiresAt`, before the hourly job marked it), `SLOT_UNAVAILABLE`, `CHANGED_MEANWHILE`.

**Tests (rules):**
- 49 h ahead can propose; 47 h ahead is refused.
- A new start 47 h away is refused.
- Expiry is the earlier of the two limits: 60 h ahead gives 12 h, a week ahead gives 48 h.
- Confirming after `expiresAt` is refused, even before the job runs.

**Logs:**
- `reschedule.proposed` and `reschedule.decided` (`accepted` / `declined` / `withdrawn`): `bookingId`, `role`.
- `reschedule.expired`: count per job run.
- The email sends already log through Brevo.

---

## For the front team (LF-0074 and what follows)

| Screen | Calls |
|---|---|
| Agenda, all four views | `GET /chef/agenda?from&to` (the visible range, up to six weeks); year view `GET /chef/agenda/summary?year=` |
| Hours editor and day panel | `PUT /chef/availability` with `version`; on 409 `SCHEDULE_CHANGED`, reload; show `details` on 422 |
| Day panel, blocks | `POST /chef/agenda/blocks`, `DELETE /chef/agenda/blocks/:id` |
| Dashboard | `GET /chef/bookings?from=<now>&limit=1` and its detail |
| Public menu | `slotsLeft` as today; it now means whole free sessions this week, at the length of the shortest active offer |
| Client reservation | `GET /chefs/:id/availability?from&to` (no `offerId` needed), then `POST /me/bookings` with the returned `offer.id`; show `offer.priceCents` |
| Client "Demander une annulation" | `PATCH /me/bookings/:id {status: 'cancelled'}`; on 409 `BOOKING_PAID`, `POST /me/conversations/support` |
| "Signaler un litige" (client or batch cooker) | `POST /me/conversations/support` for now; an admin sets `disputed` |
| Payment page of a disputed booking | read the booking's `status` first: `payment-status` answers `not-due`, and paying answers 409 `BOOKING_DISPUTED` |
| Errors | test `body.code`; show `body.requestId` as a support reference |

**Status mapping**, from the bookings plan:

| Backend status | `MissionStatus` |
|---|---|
| `pending` | `pending` |
| `confirmed` | `confirmed`, or `upcoming` from the date |
| `shopping`, `cooking` | `in-progress` |
| `delivered`, `completed` | `done` |
| `cancelled` | `cancelled` |
| `disputed` (Phase S) | `disputed` |

---

## Migrations (written, never applied by me)
- `20261015110000_booking_status_disputed`: the enum value
- `20261015120000_agenda`: time blocks, booking city and postal code, and the backfill from quotes
- `20261015130000_chef_calendar_feeds`, with `last_fetched_at`
- `20261015140000_booking_reschedules`

## Decided (2026-10-15)
1. **42 days** for the agenda window (month view), and a year summary that counts prestations only, not requests.
2. A **closed day refuses** custom requests by default. The batch cooker may still propose it in an offer. Hours are not checked for requests.
3. **`slotsLeft`** = whole sessions of the **shortest** active offer that fit the week's free time: 5 h free with a 2 h 30 offer counts as 2.
4. **Public availability** defaults to the **most expensive** active offer when the page names none.
5. **`calendarConnected`** = the batch cooker's calendar app syncs our feed (fetched in the last 7 days). The key stays for the admin console.
6. **Personal blocks included** (manual blocks only); a block cannot cover a booking.
7. A **temporary `disputed` status** (Phase S):
   - only an admin sets and clears it, from any status but `cancelled`
   - it blocks payment
   - the recipe sheet waits for `completed`
   - the commission debit is not paused
8. **`requestId` in every error body** (Phase L): additive, admin console unaffected.
9. **The feed** shows the client's first name and initial plus the address, behind a secret link.

10. **Rescheduling** (D3):
    - `confirmed` only, both starts more than 48 h away
    - 48 h to confirm, cut short to 48 h before the start
    - no time held meanwhile

## Order and verification
Phase L first, since every other phase logs through it; then Phase 0, S, D1, D1b, D2, D3. Each ends green and shippable:
```
cd apps && npx prisma generate && npx prisma validate
npx tsc --noEmit && npx eslint "src/**/*.ts" && npx jest
node --test ../brevo/*.test.mjs        # D3
```
Plus, for each phase, the offline DI and Swagger build check used on Phases A–B. It never starts the server, so no cron job touches the database.

## Status
Revision 3. No commit, no DB write, no migration applied, no push without an explicit request. batchcooking-web is only read.

| Phase | State |
|---|---|
| L | done, in the working tree |
| 0 | done, in the working tree |
| S | done, in the working tree; migration `20261015110000_booking_status_disputed` written, not applied |
| D1 | done, in the working tree; migration `20261015120000_agenda` written, not applied |
| D1b | done, in the working tree |
| D2 | done, in the working tree; migration `20261015130000_chef_calendar_feeds` written, not applied |
| D3 | done, in the working tree; migration `20261015140000_booking_reschedules` written, not applied |

## Implementation notes (where the code differs from the text above)
**Phase L:**
- Fastify access logs use the same keys as application lines:
  - `level` as a word, `message`, `timestamp`, `requestId`
  - `service`, `env`, `version`, `hostname`
- They drop the query string, through `logController` and pino options in `main.ts`.
- Nest's `log` level is written `info`.
- `AuditService` fills `requestId` from the request context when the caller passes none.
- The CESU service's existing logs became events too: `cesu.declared`, `cesu.confirmed`, `cesu.rejected`, `cesu.force_settled`.
  - The force-settle line no longer prints the admin's free-text proof reference.
- `stackOf(error)` in `common/logging/app-logger.ts` gives the stack to log beside an event.

**Phase S:** `disputed` is in `HOLDS_SLOT`. A prestation flagged before it happens keeps its time.

**Phase D1:**
- **Agenda window:** `GET /chef/agenda` accepts past windows (the month grid starts before today). Only empty windows or windows over 42 days are refused.
- **Saving working hours** (`PUT /chef/availability`):
  - It replaces the template and the exceptions from today on. Past exceptions are kept, so past months still show their days off, and any sent again are ignored.
  - `version` hashes the template plus the exceptions from today on.
  - Saves are serialised with `SELECT … FOR UPDATE` on the chef profile row.
- **Ids:** they are issued anew on every save. The DTOs accept `id` and ignore it, because the page sends its objects back as read.
- **`GET /chef/availability`** also answers `scheduled`.
- **Blocks:**
  - `uq_chef_time_blocks_chef_range` (`chef_profile_id`, `starts_at`, `ends_at`) makes a double click atomic. It replaces the plain index and serves the range reads.
  - A block must end in the future, and lasts 42 days at most.
- **A request with a date but no half-day** spans the whole day.
- **Code layout:**
  - `AgendaService` and `ChefAgendaController` live in `modules/calendar`.
  - `QuotesModule` imports `CalendarModule` for `assertOpenOn`.

**Phase D1b:**
- `slotsLeft` is on `GET /chefs/:id` too, for the current week.
- "Scheduled" means the batch cooker set hours at some point, as `assertBookable` reads it. A batch cooker who only uses extra ranges is never "anytime".
- Whole sessions are cut from each free span as is, not on the 30-minute grid.
- `GET /chefs/:id/availability` keeps `durationMinutes` beside the new `offer`.
- The demo seed still writes `availability_slots`; nothing reads it.

**Phase D2:**
- **Feed link:**
  - It is built from the request's own protocol and host, with Railway's proxy headers trusted. No new environment variable.
  - The answer gives `url` (for Google's "From URL") and `webcalUrl` (Apple, Outlook).
- **Feed route:**
  - `GET /calendar/feed/:file` strips `.ics` from the parameter, instead of a `:token.ics` route pattern.
  - It is throttled at 60 a minute per IP.
- **Turning it off** deletes the row, so `enabled` means a row exists.
- **`GET /chef/calendar-feed`** also answers `rotatedAt`, `lastFetchedAt` and `synced`, the same 7-day rule as `calendarConnected`.
- **Feed events:** `pending` bookings are `TENTATIVE`, and descriptions are in French.
- **The client's file:**
  - It is served for any status of their own booking, with `STATUS:CANCELLED` for a cancelled one.
  - It comes from `CalendarFeedService.bookingFile`, which `MeBookingsController` calls.
- **Access logs** write `/calendar/feed/:token` in place of the token.
  - Railway's own edge logs still see the path; that is outside the app.

**Phase D3:**
- **Expiry job:** a `@Cron` of its own, `BookingReschedulesService.expireDue` (`job.reschedules_expired`), instead of a step in `expireUnpaid`.
  - A proposal past its `expiresAt` that the job has not marked yet is marked `expired` before a new one is made, so it never blocks.
- **New refusal codes:**
  - `RESCHEDULE_NOT_YOURS` (409): withdrawing the other side's proposal.
  - `VALIDATION_FAILED` (422): proposing the time it already has.
- **On confirming,** the booking update is guarded on `status = 'confirmed'` and the start the proposal was made from. Two answers racing get `CHANGED_MEANWHILE`.
- **The open proposal** shows as `reschedule` on the booking detail for all three audiences, admin included (an added key), and as `rescheduleTo` in the agenda.
- **Emails:**
  - The two are best-effort: a failure logs `reschedule.mail_failed`.
  - Proposed: the client is sent to `/espace-client/commandes/:id`, the batch cooker to `/espace-chef/prestations`.
  - A withdrawal sends no email.
- **`schedule()`** in `bookings.service.ts` is exported, so a move writes the time fields exactly as a booking does.
