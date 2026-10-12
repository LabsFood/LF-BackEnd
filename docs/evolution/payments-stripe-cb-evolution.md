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

## Prefinanced CESU (e-CESU first) + the SEPA commission-debit engine

**Delivered:** 2026-09-05. Branch: `evol/payment-stripe-flux-cb` (continuation).
Migration: `20260905120000_payments_cesu_commission_debits` (idempotent).

### What makes this flow structurally different from the card one

**The funds never transit through the platform.** The client pays from their issuer's
beneficiary area (Pluxee, Edenred, UP, BIMPLI, Domiserve): they add the chef as an
intervenant using the chef's **NAN**, choose e-CESU, enter an amount and validate; the
issuer credits the chef directly and mails a confirmation to both parties.

Three consequences drive every design decision below:

1. **Nothing is programmatically verifiable.** No issuer exposes a public API, no
   transaction reference is normalised, and Domiserve runs its own circuit outside the
   CRCESU. The confirmation the client receives is a supporting document, **not a proof**.
   So the **chef** confirms — they are the party who receives both the notification and
   the money — with a traced admin override for support cases.
2. **The NAN has to be published before any payment exists.** Without it a client cannot
   add the chef on their portal at all, and invoice A is only issued once the service has
   been delivered — far too late to be the sole carrier.
3. **The commission cannot be withheld at charge time**, so it is invoiced (facture B) and
   collected by a separate SEPA direct debit. That engine — deferred out of the card phase
   — is the bulk of this work, and it will serve the avance immédiate unchanged.

Titre expiry is a non-issue: the issuer's portal refuses to spend an expired titre.

### Scope decisions (do not re-litigate without ADR)

| Topic | Decision | Rationale |
|-------|----------|-----------|
| Debit trigger | **On confirmation** (`on_payment`), switchable to `monthly_batch` by config | Both paths share `executeDebit()`, so switching changes *when* an invoice is cut, never *how* it is collected |
| Who confirms a CESU payment | **The chef**, with a traced admin override | Only party receiving the issuer's notification and the funds. Nothing else is verifiable |
| Titre millésime | **Moot** | The issuer's portal refuses an expired titre |
| CESU eligibility | `sapProfile.acceptsCesu` **and** a `crcesuNan` | An opt-in without the number is a dead end: the client cannot add the chef on their portal |
| SEPA scheme | Stripe's **CORE** accepted; risk carried by dispute tracking **and** a booking block | B2B is not available on Stripe at all — see the Stripe facts table below |
| Facture B | Delivered as a **numbered receivable + JSON**; PDF and S3 belong to the invoicing workstream | The debit has no legal basis without the invoice; the rendering has no bearing on collection |
| Paper CESU | **Secondary and deliberately unmanaged** | The platform provides the payment method, the invoice and the commission debit. Depositing, validating and cashing the titres is the chef's own responsibility — **must be written into the chef terms** |
| Client proof reference | Optional free text + issuer | Nothing about it can be checked; the attachment waits on S3 |
| Fiscal attestation | e-CESU **excluded** from what the platform attests; paper CESU still attested | The issuer already attests the share it financed. ⚠️ open with the accountant — see "Open before production" |

### Stripe facts this phase is built on

| Fact (Stripe documentation) | Consequence in the code |
|---|---|
| Stripe supports the SEPA Direct Debit **Core** scheme and **not** the B2B scheme | The "mandat SEPA B2B" of the commercial documentation **is not buildable on Stripe**. The mandate the chefs already signed is a CORE mandate |
| CORE: "no questions asked" dispute for **8 weeks**, honoured automatically, plus a dispute fee | A collected commission is **never final before 56 days** → `CommissionDebit.clawbackWindowEndsAt`, and a `reversed` state rather than a boolean |
| `paymentIntents.create` on `sepa_debit` returns `processing`, **never** `succeeded`. A late failure surfaces as **`requires_payment_method`** (a PaymentIntent has no `failed` status) | The engine is **webhook-driven**; the API response is only recorded, never trusted |
| 10 000 € per-transaction cap; `payment_method_options.sepa_debit.target_date` (3–15 days) can stagger | `SEPA_MAX_AMOUNT_CENTS` precondition, and `target_date` spreading in the batch |
| On a SetupIntent the parameter is `usage`, not `setup_future_usage` | Already correct in `sepa-mandates.service.ts` — unchanged |

**`on_behalf_of` — two charges, two opposite rules.** On the **client's card charge**
(destination charge) it is *to be added*, making the chef merchant of record for invoice A
— resolved 2026-09-05, still not implemented, and explicitly out of scope here. On the
**commission debit** it must **never** be sent: the platform is the seller on facture B,
and `on_behalf_of` would invalidate the mandate already collected by forcing a fresh
authorisation. Same for `transfer_data` and `application_fee_amount`. A dedicated test
asserts their absence.

### CESU lifecycle

```
CLIENT declares a payment  → Payment(cesu, pending) + Commission(pending, sepa_direct_debit)
  (amount, medium, issuer,    + CesuSettlement(declared)
   optional reference)
CHEF confirms receipt      → Payment.succeeded, paidAt, taxCreditEligibleAmount
                             CesuSettlement.confirmed (who, when, admin override + proof)
                             Booking.confirmed once the payments cover it
                             ⇒ facture B issued, then debited
CHEF rejects               → Payment.failed, Commission.failed, CesuSettlement.rejected
                             Booking stays pending — payable again by any method
```

`settlePayment()` (`payment-settlement.ts`), extracted from the card handler, is now the
**only** writer of `Payment.status = 'succeeded'`, `paidAt` and `taxCreditEligibleAmount`,
shared by both flows. It also owns the booking transition, which is what makes a mixed
CESU + card booking possible.

### Mixed CESU + card

`coverage(bookingId)` counts **`succeeded` payments only** — never "everything that is not
`failed`". `findReusableIntent` abandons a `pending` row whenever `paymentIntents.retrieve`
throws, and that row used to stay `pending` forever; counting it would inflate coverage and
a split booking would never reach `confirmed`. `POST /payments/intent` now charges **the
remaining amount** rather than `booking.amountTtc`, and refuses with 409 when nothing is
left. An abandoned attempt Stripe has confirmed dead (or whose amount is superseded) is
retired to `failed`; one that merely failed to load is left alone, because it may still
succeed and arrive by webhook.

Commission is computed **per payment line** — card part withheld via
`application_fee_amount`, CESU part debited via SEPA. No proportional split. The CRCESU
"no surcharge" rule is enforced structurally: a declaration can never exceed what is due,
and there is no fee field anywhere on that path.

Concurrency is held by a **partial unique index**,
`payments (booking_id) WHERE method = 'cesu' AND status <> 'failed'` — two simultaneous
declarations would each pass the coverage check. Prisma cannot express a partial index, so
it lives only in the migration.

### Webhook routing — the correction that matters most

**Never discriminate on `metadata`.** A `charge.dispute.created` carries a `Dispute` whose
`metadata` is empty and a `Mandate` has none at all, so metadata-based routing silently
misfiles exactly the events that matter. Both flows produce PaymentIntents on the platform
account, and only a **database lookup** tells them apart:

```
payment_intent.processing / .succeeded / .payment_failed
   → CommissionDebit.findUnique({ stripePaymentIntentId })  ?  commission engine
                                                            :  existing client flow
charge.dispute.created / .closed → dispute.payment_intent → same lookup
```

Newly handled: `payment_intent.processing`, `charge.dispute.created` (→ debit `reversed`,
commission `reversed`, invoice reopened, admin alert), `charge.dispute.closed` (restores
only a dispute **won**), `mandate.updated` (→ `SepaMandate.revoked`).

Every delivery passes through `StripeEventLog`. ⚠️ The de-duplication guard tests
**`processedAt`**, not the row's existence: a handler that throws has already inserted its
row, and an existence check would read Stripe's retry — the one chance to get the event
right — as a duplicate and lose it permanently.

### Unpaid-commission guard

`BookingsService.create`, `PaymentsService.createIntentForBooking` and `POST /payments/cesu`
refuse with 409 when a chef has a `CommissionInvoice` still `issued` whose debits have run
out of attempts, or a commission `reversed` after a dispute. Same double check as the
`isActive` / `isVerified` vetting — standing can change between booking and payment.

This is the counterweight to accepting CORE: rather than trying to make an eight-week
revocable debit safe, the exposure is capped at what is already owed.

### File Evolution

| File | Status | Role |
|------|--------|------|
| `apps/prisma/migrations/20260905120000_payments_cesu_commission_debits/migration.sql` | Created | Five enums, three `commission_status` values, four tables, the partial unique index, `basis_amount_cents` backfill |
| `apps/src/modules/payments/payment-settlement.ts` | Created | `settlePayment()` (sole writer of `succeeded`), `coveredAmount()`, `bookingCoverage()` |
| `apps/src/modules/payments/commission-standing.ts` | Created | `findCommissionBlock()` — the §6 guard, callable without a module import |
| `apps/src/modules/payments/chef-cesu-info.ts` | Created | One mapper publishing the NAN on the public profile, the booking and the quote |
| `apps/src/modules/payments/cesu-payments.service.ts` | Created | Declare / confirm / reject / force-settle, coverage reads, chef CESU info |
| `apps/src/modules/payments/cesu-payments.controller.ts` | Created | `PublicCesuController` (public NAN read) + client, chef and admin CESU routes |
| `apps/src/modules/payments/commission-debits.service.ts` | Created | Facture B issuance, the SEPA debit engine, the batch, the four webhook handlers |
| `apps/src/modules/payments/commission-invoices.controller.ts` | Created | Chef and admin invoice reads, `retry-debit`, `run-due` |
| `apps/src/modules/payments/dto/cesu.dto.ts` | Created | Declaration, rejection, force-settle, batch window, coverage, chef CESU info |
| `apps/src/modules/payments/dto/commission-invoice.dto.ts` | Created | Facture B and its debit attempts |
| `apps/src/modules/payments/payments.service.ts` | Changed | Charges the remaining amount; commission guard; `basisAmountCents`; settles through `settlePayment()`; retires superseded attempts |
| `apps/src/modules/payments/fiscal-attestations.service.ts` | Changed | `isPlatformAttestable()`, `platformAttestedAmountCents`, `paymentMethods`, `notes` |
| `apps/src/modules/stripe-webhooks/stripe-webhooks.service.ts` | Changed | Lookup-based routing, four new event types, `StripeEventLog` de-duplication |
| `apps/src/modules/bookings/bookings.service.ts` | Changed | Commission guard on create; `chefCesu` on the booking detail |
| `apps/src/modules/quotes/quotes.service.ts` | Changed | `chefCesu` on each quote once a chef is assigned |
| `apps/src/modules/users/users.service.ts` + `dto/sap-profile.dto.ts` | Changed | `acceptsCesu` opt-in; `setSapExternalStatus()` — the writer `crcesuAffiliationStatus` never had |
| `apps/src/config/config.loader.ts`, `env.validation.ts` | Changed | Debit trigger, max attempts, invoice prefix |

### Routes added

| Method | Route | Auth |
|---|---|---|
| GET | `/chefs/:chefProfileId/cesu-info` | **Public** |
| POST | `/payments/cesu` | Clerk (booking owner) |
| GET | `/me/bookings/:id/payment-status` | Clerk (booking owner) |
| GET | `/me/chef/cesu-payments` | Clerk (chef) |
| POST | `/me/chef/cesu-payments/:id/{confirm,reject}` | Clerk (chef) |
| GET | `/me/chef/commission-invoices` | Clerk (chef) |
| PATCH | `/admin/chefs/:id/sap-external-status` | Admin |
| GET | `/admin/cesu-payments` | Admin |
| POST | `/admin/cesu-payments/:id/force-settle` | Admin (**proof reference required**) |
| GET | `/admin/commission-invoices` | Admin |
| POST | `/admin/commission-invoices/:id/retry-debit` | Admin |
| POST | `/admin/commission-invoices/run-due` | Admin (advisory-locked) |

**No scheduler in this phase.** The repo has none, and with the debit triggered on
confirmation and no titre reimbursement to follow, nothing time-based is mandatory: the
batch and the retries are admin endpoints.

### Configuration

```
PAYMENTS_COMMISSION_DEBIT_TRIGGER=on_payment      # | monthly_batch
PAYMENTS_COMMISSION_DEBIT_MAX_ATTEMPTS=3
PAYMENTS_COMMISSION_INVOICE_PREFIX=LF-COM
```

The 56-day CORE revocation window is a **hard-coded constant**, deliberately not
configurable: it is the scheme's rule, not the platform's, and a variable invites someone
to "fix" a non-conformity by editing a value.

Stripe Dashboard events to enable: `payment_intent.processing`, `charge.dispute.created`,
`charge.dispute.closed`, `mandate.updated`.

### Verification

`npm run lint`, `npm run build`, `npm test` — 32 suites / 319 tests green.
New: `cesu-payments.service.spec.ts` (26), `commission-debits.service.spec.ts` (29).
Extended: `stripe-webhooks.service.spec.ts` (a commission `payment_intent.succeeded` must
never touch a client `Payment`; dispute routing; `processedAt` de-duplication),
`payments.service.spec.ts` (card on the remaining amount), `fiscal-attestations.service.spec.ts`
(paper attested, e-CESU not, type B excluded), `bookings.service.spec.ts` (commission guard).

**The migration has not been executed** — no Postgres was reachable in the working
environment. Run `npm run db:migrate` against a scratch database before deploying.

Manual replay against Stripe test mode: IBAN `FR1420041010050500013M02606`, and the
`generatedSepaDebitIntentsSucceed@example.com`,
`…FailsDueToInsufficientFunds@example.com`, `…SucceedDisputed@example.com` customer emails
reproduce success, late failure and dispute without waiting for real settlement.

### Open before production

1. **🔴 The CESU tax-credit basis — to be validated with the accountant.** The current rule
   excludes e-CESU and keeps paper attested. **Reservation on the record**: the medium is
   probably not the fiscally relevant axis — paper and e-CESU are both *prefinanced*, from
   the same issuers, partly funded by the employer or the CSE, and the issuer's attestation
   covers both. Attesting paper may carry the same over-declaration exposure under art. 199
   sexdecies CGI, and it is LAB'S FOOD that signs. If confirmed, the fix is **one line** in
   `isPlatformAttestable()`.
2. **Contractual vocabulary.** "Mandat SEPA B2B" in the commercial documentation and the
   terms is inaccurate and contradicts the CORE mandate actually signed, whose French text
   explicitly grants the 8-week right of withdrawal.
3. **Chef terms — paper CESU.** Decision #7 puts deposit, validation and reimbursement of
   paper titres entirely on the chef. **No chef-facing contractual document exists in the
   repos**, so this clause has nowhere to live yet. Proposed wording, pending legal review:
   > Pour les titres CESU préfinancés au format papier, LAB'S FOOD assure exclusivement la
   > mise à disposition du moyen de paiement, l'émission de la facture et le prélèvement de
   > sa commission. Le dépôt des titres auprès du CRCESU, leur validation et l'obtention de
   > leur remboursement relèvent de la seule responsabilité de l'intervenant indépendant,
   > qui en assume l'intégralité des délais et des risques.
4. **Invoice A trigger.** `payment_intent.succeeded` does not mean "service delivered", and
   CESU sharpens it: a CESU settlement can precede the service by days. Whether `bookings`
   needs a `delivered` status distinct from `confirmed` is still open.
5. **Type B — who owes the commission?** The chef or the cooperative? This phase keeps the
   chef (`SepaMandate.chefProfileId` is `@unique` on `ChefProfile`).

### Explicitly out of scope

Invoice A · PDF rendering and S3 archival of either invoice · the client proof attachment ·
avance immédiate · any CRCESU API · tracking paper-titre deposit and reimbursement (the
chef's responsibility, decision #7) · netting arrears against card payments · a cron
scheduler · CESU refunds to the client · adding `on_behalf_of` to the card charge.

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
| 2026-09-05 | **Prefinanced CESU (e-CESU first) + the SEPA commission-debit engine.** `CesuSettlement`, `CommissionInvoice` (facture B), `CommissionDebit`, `StripeEventLog`; `settlePayment()` extracted and shared; card charges the remaining amount so a booking can be split CESU + card; webhook routing by database lookup instead of metadata; unpaid-commission booking guard; `platformAttestedAmountCents`. Migration `20260905120000_payments_cesu_commission_debits` | The funds never transit through the platform on CESU, so the commission cannot be withheld at charge time and has to be invoiced then debited — the engine deferred out of the card phase, reusable as-is for the avance immédiate |
