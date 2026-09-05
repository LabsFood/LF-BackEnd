# Evolution Register — Payments (Stripe CB, Connect, commissions, SAP/SEPA foundations)

## Purpose

Track the files, routes, DTOs, entities, enums, configuration, and tests introduced or
changed by the `evol/payment-stripe-flux-cb` branch, so reviewers can see what moved and
why. Scope: **E8 — Payments** of
[`platform-spec-alignment-evolution.md`](./platform-spec-alignment-evolution.md), plus the
parts of **E2 — Bookings** that a payment needs to attach to.

Working contract for frontends and operators:
[`../payments/stripe-payments-contract.md`](../payments/stripe-payments-contract.md).

**Delivered:** 2026-08-31 → 2026-09-01. **Commits:** `50d36d2`, `dad2255`, `9bf8456`.

## Scope decisions (do not re-litigate without ADR)

| Topic | Decision | Rationale |
|-------|----------|-----------|
| Charge model | **Stripe Connect destination charge** | Commission is withheld as `application_fee_amount` at charge time — collected atomically, no payout job, no second debit |
| Connect account type | **Express**, `country: FR`, capabilities `card_payments` + `transfers` | Stripe hosts KYC; `business_type` left unset so the form can ask (micro-entreprise vs company) |
| Commission unit | **Basis points**, VAT on top, both frozen on the row | Integer arithmetic, and a later rate change cannot rewrite history |
| Booking confirmation | Only on `payment_intent.succeeded` | The API never trusts the client's confirmation result |
| `payments` ↔ `bookings` | **1:N**, not 1:1 | A failed card attempt must be retryable with a fresh PaymentIntent |
| SEPA mandate | Recorded, **never debited** in this phase | Groundwork for avance immédiate / CESU, where the fee cannot be split at charge time |
| SAP declaration | Lives in `UsersModule`, not `PaymentsModule` | Self-declared profile data, carries no Stripe secrets |
| External SAP statuses | Not writable by the chef | Same rule as `isActive` / `isVerified`: no self-habilitation |
| Fiscal attestation | JSON aggregation, **no PDF** | Legal template not validated; nothing worth persisting until a rendering exists |
| Attestation issuer | **The chef** (prestataire), one attestation per chef | Confirmed 2026-09-04. Each chef declares their own SAP route, so a single client-level document covering several independent providers would not be valid |

## File Evolution

### Payments module (new)

| File | Status | Role |
|------|--------|------|
| `apps/src/modules/payments/payments.module.ts` | Created | Wires the four controllers/services; imports `UsersModule` (`StripeService` arrives via the global `IntegrationsModule`) |
| `apps/src/modules/payments/payments.controller.ts` | Created | `POST /payments/intent` |
| `apps/src/modules/payments/payments.service.ts` | Created | Destination-charge creation, intent reuse, and the three payment webhook handlers |
| `apps/src/modules/payments/commission.util.ts` | Created | Pure bps arithmetic with clamping — no Nest dependencies |
| `apps/src/modules/payments/stripe-connect.controller.ts` | Created | `POST/GET /me/chef-profile/stripe-connect/*` |
| `apps/src/modules/payments/stripe-connect.service.ts` | Created | Express account creation, hosted onboarding links, `account.updated` mirroring |
| `apps/src/modules/payments/sepa-mandates.controller.ts` | Created | `POST/GET /me/chef-profile/sepa-mandate*` |
| `apps/src/modules/payments/sepa-mandates.service.ts` | Created | Stripe customer + SetupIntent, `setup_intent.succeeded` completion |
| `apps/src/modules/payments/fiscal-attestations.controller.ts` | Created | `/me/fiscal-attestations/:year` + two `/admin/fiscal-attestations` routes |
| `apps/src/modules/payments/fiscal-attestations.service.ts` | Created | Yearly tax-credit aggregation keyed on `paidAt`, grouped per issuing chef |
| `apps/src/modules/payments/dto/payment.dto.ts` | Created | `CreatePaymentIntentDto`, `PaymentIntentDto`, `FiscalAttestationDto` |
| `apps/src/modules/payments/dto/stripe-connect.dto.ts` | Created | Connect link/status + SEPA mandate DTOs |

### Stripe webhooks module (new)

| File | Status | Role |
|------|--------|------|
| `apps/src/modules/stripe-webhooks/stripe-webhooks.module.ts` | Created | Imports `PaymentsModule` for the three handler services |
| `apps/src/modules/stripe-webhooks/stripe-webhooks.controller.ts` | Created | `POST /webhooks/stripe`; `@ApiExcludeController` — hidden from Swagger |
| `apps/src/modules/stripe-webhooks/stripe-webhooks.service.ts` | Created | Signature verification + dispatch of the five handled event types |

### Changed elsewhere

| File | Status | Change |
|------|--------|--------|
| `apps/prisma/schema.prisma` | Updated | `Payment`, `Commission`, `SapProfile`, `SepaMandate` models; 3 Stripe flags on `ChefProfile`; 7 enums |
| `apps/prisma/migrations/20260831120000_payments_sap_sepa_foundations/migration.sql` | Created | Fully idempotent DDL + backfill (see [Data model](#data-model-evolution)) |
| `apps/src/app.module.ts` | Updated | Registers `PaymentsModule` and `StripeWebhooksModule` |
| `apps/src/main.ts` | Updated | Raw-body `preParsing` hook now matches a **list** of webhook paths; new `payments` Swagger tag |
| `apps/src/auth/fastify-raw-body.ts` | Updated | `getClerkWebhookRawBody` → `getWebhookRawBody`; added `STRIPE_WEBHOOK_PATH` and `WEBHOOK_RAW_BODY_PATHS` |
| `apps/src/modules/clerk-webhooks/clerk-webhooks.controller.ts` | Updated | Follows the renamed raw-body helper |
| `apps/src/config/config.loader.ts` | Updated | `payments.*` config block |
| `apps/src/config/env.validation.ts` | Updated | Joi rules for the four new variables |
| `apps/src/modules/users/dto/sap-profile.dto.ts` | Created | Conditional validation per declaration type |
| `apps/src/modules/users/users.controller.ts` | Updated | `GET` / `PATCH /me/chef-profile/sap` |
| `apps/src/modules/users/users.service.ts` | Updated | `getSapProfileByClerkUserId`, `updateSapProfileByClerkUserId`, `requireOwnChefProfile` |
| `apps/src/modules/bookings/bookings.controller.ts` | Updated | `POST /bookings` implemented — the `501` scaffold is gone |
| `apps/src/modules/bookings/bookings.service.ts` | Updated | `create()` + `nextReference()` (`LF-<year>-NNNN`) |
| `apps/src/modules/bookings/dto/booking-read.dto.ts` | Updated | Exposes `reference`, `amountTtc`, `amountAfterTax` |
| `.env.example` | Updated | Stripe webhook guidance + the four `PAYMENTS_*` / `STRIPE_CONNECT_*` variables |
| `apps/.eslintrc.js` | Updated | Ignores `src/generated/**` — the Prisma client is rewritten on every `prisma generate`, its formatting is the generator's business |

## Route Evolution

| Route | Status | Auth | Notes |
|-------|--------|------|-------|
| `POST /payments/intent` | Created | Clerk (booking owner) | Destination charge; reuses a live pending intent instead of double-charging |
| `POST /me/chef-profile/stripe-connect/link` | Created | Clerk | Creates the Express account on first call; single-use, short-lived URL |
| `GET /me/chef-profile/stripe-connect/status` | Created | Clerk | Reads mirrored flags from Postgres, not the Stripe API |
| `POST /me/chef-profile/sepa-mandate/setup-intent` | Created | Clerk | SetupIntent only — **no debit** |
| `GET /me/chef-profile/sepa-mandate` | Created | Clerk | `null` when no mandate started |
| `GET /me/chef-profile/sap` | Created | Clerk | `null` when not declared yet |
| `PATCH /me/chef-profile/sap` | Created | Clerk | Upsert; clears the other type's fields on switch |
| `GET /me/fiscal-attestations/:year` | Created | Clerk | JSON totals + per-chef `providers[]`, no PDF |
| `GET /admin/fiscal-attestations` | Created | Admin | `?year=`, defaults to the current UTC year |
| `GET /admin/fiscal-attestations/:clientId` | Created | Admin | `404` on unknown client |
| `POST /webhooks/stripe` | Created | Signature | Public, raw-body verified, excluded from Swagger |
| `POST /bookings` | **Changed** | Clerk | Was a `501` scaffold; now persists a `pending` booking. **Breaking for any caller that asserted `501`** |

All new authenticated routes answer `409` when the chef profile does not exist yet, and
`503` when `STRIPE_SECRET_KEY` is unset.

## Data model evolution

### Tables

| Table | Status | Notes |
|-------|--------|-------|
| `payments` | **Reshaped** | Existed from `20250522130000_spec_domain`. `amount` → `amount_ttc`; `user_id` dropped (payer reachable via `bookings.client_id`); `stripe_payment_intent_id` now nullable + uniquely indexed as `uq_payments_…`; added `booking_id` (NOT NULL), `method`, `currency`, `stripe_charge_id`, `tax_credit_eligible_amount`, `paid_at`, `refunded_amount`, `refunded_at`, `failure_reason`, `metadata` |
| `commissions` | Created | 1:1 with a payment; frozen `rate_bps` / `vat_rate_bps`; denormalised `chef_profile_id` for admin queries |
| `sap_profiles` | Created | 1:1 with `chef_profiles`, `ON DELETE CASCADE` |
| `sepa_mandates` | Created | 1:1 with `chef_profiles`, `ON DELETE CASCADE` |
| `chef_profiles` | Altered | `stripe_charges_enabled`, `stripe_payouts_enabled`, `stripe_details_submitted` — mirrored from `account.updated`, never set by hand |
| `bookings` | Altered | `payment_id` dropped — superseded by `payments.booking_id`, after the backfill consumes it |

### Enums

| Enum | Status | Values |
|------|--------|--------|
| `payment_method` | Created | `cb`, `avance_immediate`, `cesu` |
| `payment_status` | **Extended** | Pre-existing `pending`, `paid`, `refunded` + `succeeded`, `failed`, `partially_refunded`, ordered to read as the real flow. `paid` is reserved for the invoiceable step and **is not set by any code path yet** |
| `commission_collection_method` | Created | `stripe_application_fee`, `sepa_direct_debit` |
| `commission_status` | Created | `pending`, `collected`, `failed` |
| `sap_declaration_type` | Created | `type_a_nova`, `type_b_cooperative` |
| `sap_external_status` | Created | `not_started`, `pending`, `active` — inert this phase |
| `sepa_mandate_status` | Created | `pending`, `active`, `revoked`, `failed` |

### Migration notes

`20260831120000_payments_sap_sepa_foundations` is **fully idempotent** — every `CREATE`
is guarded, every `ALTER` uses `IF EXISTS` / `IF NOT EXISTS`, enum values use
`ADD VALUE IF NOT EXISTS`. Prisma does not wrap a migration file in a transaction, so a
mid-file failure commits everything before it and `migrate deploy` replays from the top;
this file failed that way twice during development (on `payment_status`, then on
`payment_method`). Same approach as `20260524173000_provider_role_to_chef`.

Backfill order: invert `bookings.payment_id` → `payments.booking_id`, then fall back to
matching on `bookings.stripe_payment_intent_id` (de-duplicated with `DISTINCT ON`, since
that column has no unique constraint), then **delete** any `payments` row still without a
booking — `booking_id` is `NOT NULL`. Check a production dump before deploying if legacy
payment rows matter.

## Variable and DTO Evolution

| Symbol | Status | Role |
|--------|--------|------|
| `CreatePaymentIntentDto.bookingId` | Created | UUID of the booking to pay; must be owned by the caller and `pending` |
| `PaymentIntentDto.clientSecret` | Created | Confirmed with Stripe.js; the backend never sees card details |
| `PaymentIntentDto.commissionTtc` | Created | What Stripe withholds as `application_fee_amount` |
| `StripeConnectStatusDto.chargesEnabled` / `payoutsEnabled` / `detailsSubmitted` | Created | Mirrored from `account.updated`; both of the first two gate payability |
| `StripeConnectLinkDto.url` | Created | Single-use hosted onboarding URL — must not be cached |
| `SepaMandateSetupIntentDto.clientSecret` | Created | Confirmed with Stripe Elements; the IBAN never reaches the backend |
| `SepaMandateStatusDto.ibanLast4` | Created | The only part of the bank details persisted |
| `FiscalAttestationDto.eligibleAmountCents` | Created | Sum over `succeeded` payments of the year, across all providers (dashboard only) |
| `FiscalAttestationDto.providers` | Created | Per-chef breakdown — the unit an attestation is actually issued for |
| `FiscalAttestationProviderDto.sapDeclared` | Created | `false` when the chef has no `SapProfile` and cannot issue an attestation |
| `UpdateMeSapProfileDto.declarationType` | Created | `type_a_nova` requires `novaCode`; `type_b_cooperative` requires `cooperativeName` + `cooperativeMembershipProof` (`@ValidateIf`) |
| `SapProfileDto.urssafTiersPrestationStatus` / `crcesuAffiliationStatus` | Created | Read-only; absent from the update DTO by design |
| `BookingReadDto.reference` / `amountTtc` / `amountAfterTax` | Created | Reference `LF-<year>-NNNN`; `amountAfterTax = amountTtc / 2` |
| `AppConfig.payments.*` | Created | `commissionRateBps`, `commissionVatRateBps`, `stripeConnectRefreshUrl`, `stripeConnectReturnUrl` |
| `WEBHOOK_RAW_BODY_PATHS` | Created | Paths whose raw bytes the `preParsing` hook captures (Clerk + Stripe) |
| `TAX_CREDIT_RATE` | Created | `0.5` — SPEC-BACKEND §4.3 |
| `CONFIRMABLE_INTENT_STATUSES` | Created | Stripe statuses a client can still confirm; anything else forces a fresh intent |

## Function and Class Evolution

| Symbol | Status | Responsibility |
|--------|--------|----------------|
| `PaymentsService.createIntentForBooking()` | Created | Ownership + status + onboarding checks, commission freeze, destination charge, `payment` + `commission` in one transaction |
| `PaymentsService.findReusableIntent()` | Created | Returns the live pending intent on a double-click; `409` if Stripe already settled it; drops unconfirmable intents |
| `PaymentsService.handlePaymentIntentSucceeded()` | Created | payment `succeeded` + commission `collected` + booking `confirmed`, idempotent |
| `PaymentsService.handlePaymentIntentFailed()` | Created | Marks the attempt failed; refuses to downgrade an already-settled payment; booking stays `pending` |
| `PaymentsService.handleChargeRefunded()` | Created | `refunded` / `partially_refunded`; commission deliberately untouched |
| `computeCommission()` | Created | bps arithmetic, VAT from the rounded HT, clamped to the charge |
| `StripeConnectService.createOnboardingLink()` | Created | Creates the Express account once, then mints a fresh account link per call |
| `StripeConnectService.getStatus()` | Created | Reads the mirrored flags from Postgres (polled by the frontend) |
| `StripeConnectService.handleAccountUpdated()` | Created | `updateMany` on the account id — idempotent, no-op for unknown accounts |
| `SepaMandatesService.createSetupIntent()` | Created | Stripe customer (reused) + `sepa_debit` SetupIntent, upserts the mandate row |
| `SepaMandatesService.handleSetupIntentSucceeded()` | Created | Mandate `active`, stores mandate id + `ibanLast4`; a failed PaymentMethod read is non-fatal |
| `FiscalAttestationsService.summarizeForClerkUser()` / `summarizeForClientId()` / `summarizeAllClients()` | Created | Yearly totals for self, one client, and all clients |
| `FiscalAttestationsService.buildAttestation()` | Created | Groups a client's payments by issuing chef and totals each side |
| `FiscalAttestationsService.loadPayments()` | Created | `succeeded` + `paidAt` within the UTC year — settlement date, not creation date, decides the tax year — joined to client and chef SAP declaration |
| `StripeWebhooksService.verifyAndHandle()` | Created | `constructEvent` against the raw bytes, then dispatch |
| `BookingsService.create()` | Created | Persists the `pending` booking; `chefId` wins over the legacy `providerId` |
| `BookingsService.nextReference()` | Created | `LF-<year>-NNNN`, same counting scheme as `QuotesService.nextReference()` |
| `UsersService.updateSapProfileByClerkUserId()` | Created | Upsert; clears the other declaration type's fields |
| `UsersService.requireOwnChefProfile()` | Created | `409` before `PATCH /me/chef-profile` has run |
| `getWebhookRawBody()` | Renamed | Was `getClerkWebhookRawBody()`; now shared by both webhook controllers |

## Test Evolution

`cd apps && npm test` — **28 suites / 211 tests green** as of 2026-09-01.

| Spec file | Status | Tests | Focus |
|-----------|--------|-------|-------|
| `payments/payments.service.spec.ts` | Created | 18 | Guards, commission freeze, intent reuse, the three webhook handlers, idempotency |
| `payments/stripe-connect.service.spec.ts` | Created | 7 | Account creation once, fresh links, flag mirroring, unknown account |
| `payments/sepa-mandates.service.spec.ts` | Created | 8 | Customer reuse, upsert, mandate completion, IBAN read failure |
| `payments/fiscal-attestations.service.spec.ts` | Created | 9 | Per-chef grouping, SAP declaration carried per provider, undeclared chef flagged, year boundaries, admin aggregation |
| `payments/commission.util.spec.ts` | Created | 5 | Rounding, `HT + VAT === TTC`, clamping, zero rate |
| `stripe-webhooks/stripe-webhooks.service.spec.ts` | Created | 10 | Dispatch per event type, unknown types, missing config |
| `users/dto/sap-profile.dto.spec.ts` | Created | 8 | Conditional required fields per declaration type |
| `users/users.service.spec.ts` | Updated | +6 | SAP upsert/read, field clearing on switch, no self-declared habilitation |
| `bookings/bookings.service.spec.ts` | Created | 6 | Creation, reference sequence, unknown chef/offer |
| `bookings/bookings.controller.spec.ts` | Created | 3 | `endsAt > startsAt`, delegation, DTO mapping |
| `config/config.loader.spec.ts` | Updated | +3 | bps defaults, numeric coercion, Connect redirect defaults |

Not covered: no e2e test hits `POST /webhooks/stripe` with a real Stripe signature, and
no test exercises the migration's backfill against legacy rows.

## Configuration Evolution

| Variable | Status | Default |
|----------|--------|---------|
| `PAYMENTS_COMMISSION_RATE_BPS` | Created | `1500` — the contracted 15 % HT (confirmed 2026-09-04) |
| `PAYMENTS_COMMISSION_VAT_RATE_BPS` | Created | `2000` |
| `STRIPE_CONNECT_RETURN_URL` | Created | `http://localhost:3005/chef/onboarding/stripe/return` |
| `STRIPE_CONNECT_REFRESH_URL` | Created | `http://localhost:3005/chef/onboarding/stripe/refresh` |
| `STRIPE_WEBHOOK_SECRET` | Documented | Now actually consumed — endpoint + event list documented in `.env.example` |

## Documentation Evolution

| File | Status | Update rule |
|------|--------|-------------|
| `docs/payments/stripe-payments-contract.md` | Created | Update on any change to the payment routes, webhook events, or commission arithmetic |
| `docs/evolution/payments-stripe-cb-evolution.md` | Created | This register — append to the change log per delivery |
| `docs/evolution/platform-spec-alignment-evolution.md` | Updated | E8 closed, E2 partially closed, traceability + checklists refreshed |
| `docs/architecture.md` | Updated | Module layout, routes, integrations, ER diagram, doc map |
| `docs/deploy/railway.md` | Updated | Payment env vars + Stripe webhook in the blockers checklist |
| `README.md`, `apps/README.md`, `AGENTS.md`, `stack.md` | Updated | Payments surface, local `stripe listen` workflow, doc index |
| `docs/Revisions_followup.md` | Updated | Release register row |

## Known follow-ups

| Item | Why it matters |
|------|----------------|
| **Refund flow** | No API refunds; the commission is not clawed back on a refund (Stripe keeps the fee unless asked) |
| **PDF attestation** | Clients get JSON; the signed document is a separate deliverable pending the legal template. The renderer must emit **one document per `providers[]` entry**, not one per client |
| **`paid` status unused** | The enum carries an invoiceable state no code path sets — decide whether it stays |
| **`avance immédiate` / CESU** | Enums, `payments.metadata`, and the SEPA mandate exist; no flow is implemented, and the mandate has never been debited end-to-end |
| **URSSAF / CRCESU** | Statuses are inert and no admin route flips them |
| **Admin surface** | No `/admin/payments` or `/admin/commissions` list |
| **`is_active` / `is_verified` still unread** | An unvetted chef who finishes Connect onboarding is payable — inherited gap, now with money attached |
| **Email verification off** | Flagged as a pre-payments risk in the Clerk contract; payments shipped first, the gap is still open |
| **Legacy `payments` rows** | The migration deletes rows it cannot attach to a booking |
| **Invoicing — two invoice types + S3 archival** | Not implemented. Business rule confirmed 2026-09-05 — see dedicated section below |

### Invoicing — two invoice types (not yet implemented, confirmed 2026-09-05)

Every booking needs **two separate invoices**, not one:

**A — Service invoice, client-facing, issued in the prestataire's name**

| Field | Value |
|-------|-------|
| Issuer (named party) | The chef/prestataire — the platform generates the document on their behalf |
| Recipient | The client |
| Content | Client name, prestataire name, the invoice line item(s) (the service/booking rendered) |
| Payment method shown | Which `payment_method` was used for the booking: `cb`, `cesu` (shown as "CESU financé"), or — future — `avance_immediate` |
| Trigger | When the prestataire has **delivered the service** — **to confirm**: this is not necessarily `payment_intent.succeeded` (that only means the client was charged). Check whether bookings have a "completed"/"delivered" status distinct from `confirmed`, or whether one needs to be added |

**B — Commission invoice, chef-facing, issued by the platform**

| Field | Value |
|-------|-------|
| Issuer | The platform |
| Recipient ("client" of this invoice) | The chef/prestataire |
| Object | The commission the platform collects on the booking (the existing `commissions` row — frozen `rate_bps` / `vat_rate_bps`) |
| Role | This invoice is the **legal basis for collecting the commission** — the prélèvement is made against it, not just against the raw `application_fee_amount` |
| Collection method | Depends on how the client paid, which already matches the existing `commission_collection_method` enum: `cb` → commission already withheld atomically as `application_fee_amount` on the destination charge (implemented; invoice B documents a collection that already happened); `cesu` / future `avance_immediate` → per the existing SEPA mandate decision ("the fee cannot be split at charge time"), the commission has to be collected afterward via a separate SEPA prélèvement, issued against invoice B |

**Both invoice types get the S3 backup** from the follow-up above: whichever party the
invoice is issued to (client for A, prestataire for B) is served directly by Stripe
(or the platform's generated PDF) — never by S3. S3 only holds a private, write-only
copy for the 10-year legal retention (Code de commerce), with the object key recorded
in Postgres against the owning row (new `invoices` table, or columns on `payments` /
`commissions` — shape TBD).

**Confirmed 2026-09-05**: invoice B does show which underlying payment method the
booking used (mirrors invoice A's field) — that's exactly what decides whether the
commission was already taken via `stripe_application_fee` or still needs a
`sepa_direct_debit` prélèvement.

**Resolved 2026-09-05 — Stripe mechanism for invoice A's seller-of-record**: keep the
existing **destination charge** (no switch to direct charges — the CB split stays
exactly as implemented). Add **`on_behalf_of`** (the chef's Connect account id)
alongside the existing `transfer_data.destination` and `application_fee_amount` on the
PaymentIntent/charge, and the same trio on the Invoice object if/when a real Stripe
`Invoice` is created for the document. This is Stripe's documented pattern for making
the connected account the **merchant of record** on an indirect charge ("Indirect
charges using the `on_behalf_of` parameter: the merchant of record is the connected
account" — [Understand the merchant of record](https://docs.stripe.com/connect/merchant-of-record)):
Stripe then uses the chef's account branding on the receipt/invoice instead of the
platform's, satisfying "invoice A in the prestataire's name" with **one added
parameter**, no restructuring.

No re-onboarding needed: `on_behalf_of` requires the connected account to be under
Stripe's `full` service agreement, and any account with the `card_payments` capability
(which the chef Express accounts already request — see Scope decisions above) is
already on `full` — `recipient`-agreement accounts can't request `card_payments` at
all, so this isn't a gap here.

Still not implemented: `PaymentsService.createIntentForBooking()` doesn't set
`on_behalf_of` today. When this ships, add it there for invoice A; invoice B (the
platform's own commission invoice) does **not** use `on_behalf_of` — the platform is
already the seller on that one.

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-08-31 | Stripe Connect onboarding, destination-charge PaymentIntent, commissions, SEPA mandate, SAP profile, fiscal attestations, `POST /webhooks/stripe`, `POST /bookings` implementation (`50d36d2`) | Deliver E8 and the booking creation E2 depends on |
| 2026-08-31 | `payment_status` extended in place instead of recreated; `payments` altered rather than created (`dad2255`) | The enum and table already existed from `20250522130000_spec_domain` |
| 2026-09-01 | Every migration statement made idempotent with guarded `DO` blocks (`9bf8456`) | Prisma runs migration files outside a transaction; two partial failures left debris that `migrate deploy` replayed into |
| 2026-09-01 | Created this register and `docs/payments/stripe-payments-contract.md`; refreshed the platform register, architecture, deploy, and README docs | Document the branch |
| 2026-09-04 | Attestation reshaped per issuing chef (`providers[]`); commission rate confirmed at 15 % HT (no longer a placeholder) | The chef is the declared provider (prestataire), so one attestation is issued per chef, carrying that chef's own SAP declaration |
| 2026-09-05 | Added "Invoicing — two invoice types" follow-up: a client-facing service invoice issued in the prestataire's name, and a chef-facing commission invoice issued by the platform, both backed up (never served) to S3 for legal retention | Product decision: two distinct invoices per booking, not one — the service invoice and the commission invoice have different issuers, recipients, and objects, and the commission invoice's collection method (`stripe_application_fee` vs `sepa_direct_debit` prélèvement) depends on the booking's payment method. No code change — planned for after the payment-methods work on this branch |
| 2026-09-05 | Resolved invoice A's seller-of-record mechanism: add `on_behalf_of` to the existing destination-charge PaymentIntent, keep `transfer_data.destination` + `application_fee_amount` unchanged | Confirmed via Stripe docs — `on_behalf_of` on an indirect (destination) charge makes the connected account the merchant of record without switching to direct charges; chef Express accounts already qualify (they hold `card_payments`, which requires the `full` service agreement). No code change yet |
