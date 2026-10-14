# In-house batch cooker calendar

> Written on 2026-10-14, after Cronofy was rolled back. Builds on Phase B of
> [`bookings-roles-cronofy.plan.md`](./bookings-roles-cronofy.plan.md): working hours,
> free slots and `assertBookable` already exist in `modules/calendar/`.

## Context

**Decision:** the calendar is ours. No third-party calendar provider: nothing to link, no tokens to keep, no outside busy time. The batch cooker's time is what we know: working hours, bookings and, new here, the blocks they set themselves.

**What exists** (committed on `feat/bookings-roles-cronofy`):
- `GET/PUT /chef/availability`: weekly template plus dated exceptions (`closed` day, `extra` range).
- `GET /chef/availability/slots` and the public `GET /chefs/:id/availability`.
- `AvailabilityService.assertBookable`, checked on every booking made or moved by a client or batch cooker.
- Bookings hold the slot from `pending` on; an unpaid one is freed after 72 h.

**What the web agenda needs** (`batchcooking-web/app/espace-chef/agenda`, read-only reference): one view drawing working ranges, accepted prestations and new custom requests together. Today it stitches three mock sources.

**Chosen scope:**
1. One agenda endpoint.
2. A calendar feed (`.ics`): a private link the batch cooker subscribes to from Google, Apple or Outlook, plus an "add to calendar" file for the client.
3. Rescheduling a confirmed booking, both sides agreeing.
4. Not chosen: reading the batch cooker's other calendars. Manual blocks only.

**Cleanup first:** the original Cronofy scaffold (`integrations/cronofy.service.ts`) is still in the code, unused. See Phase 0.

---

## Phase 0: remove the Cronofy scaffold

The rollback restored the scaffold as it was before this work. It is dead code now.
- Delete `integrations/cronofy.service.ts` and its spec; drop it from `integrations.module.ts`.
- Remove the `cronofy` block from `config.loader.ts`, the three `CRONOFY_*` variables from `env.validation.ts` and `.env.example`, and their rows in `docs/deploy/railway.md` and `docs/architecture.md`.
- **Keep** the columns `chef_profiles.cronofy_profile_id` and `bookings.cronofy_event_id`: dropping them is a migration, for no gain. Both stay unused.
- Railway: nothing to remove. No Cronofy variable was ever set there.

---

## Phase D1: the agenda and personal blocks

### Prisma
```prisma
model ChefTimeBlock {              // @@map("chef_time_blocks")
  id, chefProfileId (FK chef_profiles, cascade),
  startsAt DateTime @db.Timestamptz(6), endsAt DateTime @db.Timestamptz(6),
  reason String? @db.VarChar(255), createdAt,
  @@index([chefProfileId, startsAt])
}
```
Migration `20261015120000_chef_time_blocks`, with `CHECK (starts_at < ends_at)`.

Why blocks: a `closed` exception takes a whole day. A block takes a stretch inside a day (a doctor's appointment, an errand).

### Routes (tag `chefBookings`, `ClerkAuthGuard`, `chefIdentity`)
- `GET /chef/agenda?from&to`: 31 days at most. One answer for the whole page:
  - `working`: the working ranges in the window (ISO instants), and `scheduled: false` when no hours are set
  - `prestations`: the batch cooker's non-cancelled bookings overlapping the window: `id, reference, status, startsAt, endsAt, timeSlot, persons, addressLine`, and the client as first name and initial
  - `requests`: custom requests waiting for their answer (`assignedChefUserId`, status in `AWAITING_CHEF`): `id, reference, title, persons`, and `startsAt` / `endsAt` from `desiredDate` and `timeSlot` through `slotWindow`, `null` when the client gave none
  - `blocks`: `id, startsAt, endsAt, reason`
- `POST /chef/agenda/blocks` `{startsAt, endsAt, reason?}`; `DELETE /chef/agenda/blocks/:id`.
  - 422 if it ends before it starts, is in the past, or is longer than 31 days.
  - **409 `BLOCK_OVERLAPS_BOOKING`** if a non-cancelled booking is inside it: the batch cooker cancels that booking first, so a block never hides a prestation.
  - At most 200 blocks ahead (409 `TOO_MANY_BLOCKS`).

### Code
- `AvailabilityService.busy` adds the blocks: bookings and blocks both take time from the free slots, and `assertBookable` refuses a time they hold.
- New `calendar/agenda.service.ts` and `chef-agenda.controller.ts`. It reads `prisma.quote` and `prisma.booking` directly; `CalendarModule` imports neither `QuotesModule` nor `BookingsModule`.

### Tests
- Agenda: a cancelled booking is left out; a request without a date has no window; another batch cooker's data never appears; a 32-day window is refused.
- Blocks: an overlapping booking refuses the block; a block removes the slots it covers from `freeSlots`; `assertBookable` refuses a time inside a block.

---

## Phase D2: the calendar feed (`.ics`)

### For the batch cooker
A private link they subscribe to from Google, Apple or Outlook. Read-only, ours to serve, nothing to authorize.

**Prisma:** `ChefCalendarFeed` (`chef_calendar_feeds`): `chefProfileId` unique (FK, cascade), `tokenHash` (SHA-256 of the token), `createdAt`, `rotatedAt`. Migration `20261015130000_chef_calendar_feeds`.

**Routes:**
- `GET /chef/calendar-feed`: `{enabled, createdAt}`. The token is never readable again.
- `POST /chef/calendar-feed`: creates or **rotates** the link and answers its `url` once. The old link stops working at once.
- `DELETE /chef/calendar-feed`: turns it off.
- `GET /calendar/feed/:token.ics`: **public**, throttled, `text/calendar`, `Cache-Control: private, no-store`. Unknown or turned-off token: 404, with no hint which.

**The feed:** every booking of that batch cooker not cancelled, from 30 days back to 12 months ahead. One `VEVENT` each: `UID` the booking id, `SUMMARY` "Prestation LF-… · Sophie M.", `LOCATION` the address, `DESCRIPTION` the persons and the status (and "en attente de paiement" while pending), times in UTC. Personal blocks are not in it: the batch cooker made them, in their own calendar.

**Privacy:** the feed carries a client's first name and address into a third-party calendar app. The link is a secret (32 random bytes, only its hash stored), and rotating it revokes it.

### For the client
`GET /me/bookings/:id/calendar.ics` (signed in, own booking): one event, as an attachment. The web page fetches it with the token and offers the download.

### Code
- `calendar/domain/ics.ts`: pure functions. Line folding at 75 octets, CRLF, escaping of `\`, `;`, `,` and newlines, UTC `DTSTAMP`. No dependency.
- `calendar/calendar-feed.service.ts`, `chef-calendar-feed.controller.ts`, `public-calendar-feed.controller.ts`; the client route in `me-bookings.controller.ts`.
- `ponytail:` the feed is built on every request, no cache. Subscribers poll every few hours; add a short cache if it shows in the metrics.

### Tests
- `ics.spec.ts`: escaping, folding, UTC, a booking with no address.
- Feed: a rotated token stops the old link; a turned-off feed is 404; another batch cooker's bookings never appear; cancelled bookings are left out.

---

## Phase D3: rescheduling a confirmed booking

Today only a `pending` booking can change its time, and only the client can. A `confirmed` one is locked (`BOOKING_LOCKED`), so a prestation that must move has to be cancelled, which needs nothing paid. This adds a proposal the other side answers.

### Rules
- Either the client or the batch cooker proposes a new `startsAt`. The duration stays.
- Only a `confirmed` booking whose start is more than 24 h away.
- One open proposal per booking. A new one needs the old one answered or withdrawn.
- The new time must pass `assertBookable`, ignoring this booking, **when proposed and again when accepted**.
  - `ponytail:` the time is not held during the proposal. Two proposals for the same free hour can both be made; the second to be accepted fails with `SLOT_UNAVAILABLE`.
- The other side answers `accepted` or `declined`; the proposer may `withdraw`.
- It expires after 48 h, or at the booking's current start, whichever comes first.
- Accepting updates `startsAt`, `endsAt`, `bookingDate` and `timeSlot` in one transaction, guarded on the booking still being `confirmed` and unmoved (`CHANGED_MEANWHILE` otherwise). The price and any payment stay as they are.
- An admin keeps `PATCH /admin/bookings/:id`, which moves a booking directly, audited.

### Prisma
```prisma
model BookingReschedule {          // @@map("booking_reschedules")
  id, bookingId (FK bookings, cascade),
  proposedByRole String @db.VarChar(8) /* client | chef */,
  proposedByUserId (FK users, set null),
  fromStartsAt, toStartsAt DateTime @db.Timestamptz(6),
  status String @default("pending") @db.VarChar(10) /* pending|accepted|declined|withdrawn|expired */,
  expiresAt, decidedAt?, createdAt,
  @@index([bookingId, createdAt])
}
```
Migration `20261015140000_booking_reschedules`, with a **partial unique index** `(booking_id) WHERE status = 'pending'` (it lives only in the migration, like `uq_payments_live_cesu_booking_id`) and a CHECK on the two enums-as-strings.

### Routes
| Audience | Propose | Answer |
|---|---|---|
| Client | `POST /me/bookings/:id/reschedule` `{startsAt}` | `PATCH /me/bookings/:id/reschedule` `{decision: accepted\|declined\|withdrawn}` |
| Batch cooker | `POST /chef/bookings/:id/reschedule` `{startsAt}` | `PATCH /chef/bookings/:id/reschedule` `{decision}` |

The booking detail gains `reschedule: {proposedBy, from, to, expiresAt} | null` (the open proposal), for client, batch cooker and admin.

**Errors:** `BOOKING_NOT_RESCHEDULABLE` (not confirmed, or start within 24 h), `RESCHEDULE_PENDING`, `RESCHEDULE_NOT_FOUND`, `RESCHEDULE_OWN_PROPOSAL` (the proposer cannot accept their own), `SLOT_UNAVAILABLE`, `CHANGED_MEANWHILE`.

### Emails (Brevo)
Two new templates, best-effort like the others:
- `BREVO_TPL_BOOKING_RESCHEDULE_PROPOSED`: to the other side, with the old and new time and a link to answer.
- `BREVO_TPL_BOOKING_RESCHEDULE_ANSWERED`: to the proposer, accepted or declined.

Files: `brevo/templates/…`, `config.loader.ts`, `env.validation.ts`, `.env.example`, `brevo/README.md`, `BookingsMailer`. **The two ids go on Railway too** (develop, then staging and production).

### Code
- `bookings/booking-reschedules.service.ts`; the routes in the existing `me-bookings.controller.ts` and `chef-bookings.controller.ts`.
- The hourly job in `BookingsService.expireUnpaid` also marks past-due proposals `expired` (an `updateMany` on `status = 'pending'`, safe on several instances).
- `GET /chef/agenda` shows a prestation with an open proposal flagged, so the agenda can draw the target time.

### Tests
- Pure rules: who may propose, the 24 h limit, the expiry time.
- Service: both sides propose; the proposer cannot accept their own; accepting rechecks availability; a second open proposal is refused; accepting moves the four time fields only; a booking changed meanwhile fails with `CHANGED_MEANWHILE`; the expiry job.

---

## Migrations (written, never applied by me)
- `20261015120000_chef_time_blocks`
- `20261015130000_chef_calendar_feeds`
- `20261015140000_booking_reschedules`

**If `20261014140000_chef_calendar_connections` was already applied anywhere** (I deleted it with the Cronofy rollback, and never applied it), that table exists and needs `DROP TABLE chef_calendar_connections` in a migration of its own. Check `_prisma_migrations` on dev first; I won't touch the database.

## Frontend dependency (batchcooking-web; not touched unless you ask)
- The agenda page reads `GET /chef/agenda` instead of three mock sources, and `PUT /chef/availability` replaces its local state.
- Block and unblock time, from the day view.
- A "Mon calendrier" panel: show the feed link once, rotate it, turn it off.
- "Add to calendar" on a client booking.
- A "Proposer un autre horaire" flow on a confirmed prestation, on both sides.

## Assumptions to confirm
1. Personal blocks are **included** though you did not tick them: "manual blocks only" presupposes a way to block, and a `closed` exception only takes whole days. Drop D1's blocks if you want only the agenda endpoint.
2. A block cannot cover an existing booking: the batch cooker cancels the booking first.
3. The feed carries the client's first name and initial plus the address, behind a secret link.
4. Rescheduling: `confirmed` only, more than 24 h before the start, 48 h to answer, no time held meanwhile.
5. Rescheduling does not touch the price or payments.
6. Cronofy scaffold removal (Phase 0), keeping the two unused columns.

## Verification
```
cd apps && npx prisma generate && npx prisma validate
npx tsc --noEmit && npx eslint "src/**/*.ts" && npx jest
node --test ../brevo/*.test.mjs
```
Each phase ends green and shippable on its own: D1, then D2, then D3.

## Status
Planned, not started. No commit, no DB write, no migration applied, no push without an explicit request.
