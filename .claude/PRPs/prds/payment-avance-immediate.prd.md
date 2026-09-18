# Avance immédiate de crédit d'impôt — Labs Food as URSSAF intermediary

## Problem Statement

Independent chefs on Labs Food (micro-entrepreneurs declared *services à la personne*) cannot
offer the URSSAF *avance immédiate* without either joining a cooperative (Unipros €39.99/month,
others 3–15 % commission) or obtaining their own URSSAF API habilitation plus compatible
software — paperwork most of them are not equipped for. Without it, the household client pays
100 % upfront and recovers the 50 % tax credit only the following fiscal year. The cost of not
solving it: clients hesitate at checkout, and chefs leave for cooperatives (Unipros, MDSAP,
Accès SAP) that bundle avance immédiate — taking their bookings off the marketplace.

## Evidence

- Competitors bundle it as their core offer: Unipros (€39.99/month flat, no commission, +€10
  cooperative shares), other SAP cooperatives at 3–15 % commission (most ~10–12 %), Accès SAP
  handles avance immédiate for all members.
- The alternative for a chef alone — own habilitation on DataPass (SIRET, NOVA number, tax
  compliance certificate < 1 month, pro bank account) plus €0–42/month software — is exactly the
  admin load the target chef avoids.
- Target chef profile (mostly women in their mid-40s with little admin know-how):
  **Assumption — product owner observation, to validate through chef onboarding data and interviews.**
- Client "double incentive" (half price + nothing paid at booking): **Assumption — to validate
  through checkout conversion split by payment method.**
- No quantitative baseline yet (conversion, abandonment, admin hours): **TBD — capture at launch.**

## Proposed Solution

Labs Food, habilitated **as a platform** on the URSSAF *API Tiers de prestation* — the API URSSAF
designates for a "plateforme de mise en relation" between clients and auto-entrepreneurs —
transmits on behalf of independent chefs: it registers clients with URSSAF (méthode 010), checks
their status (020), sends a *demande de paiement* (050, nature code **120 — préparation de repas
à domicile**) the moment the chef marks the service delivered, and polls its outcome (070).
Labs Food is **not a cooperative**: it only transmits to URSSAF; the chef stays the service
provider and **URSSAF pays the chef directly** (product owner decision — see Open Questions for
the confirmation still owed by URSSAF). Labs Food collects its commission through the existing
commission invoice (facture B) + SEPA debit engine, issued as soon as the service is marked
delivered. Avance immédiate becomes a third payment method next to CB and e-CESU and covers only
the service lines; groceries are paid by card at checkout. Chefs who belong to a cooperative
choose between their cooperative and Labs Food as intermediary. This approach reuses the payment
groundwork already built on `feat/payment-cesu-prefinanced` (payment method enum, `SapProfile`,
commission-debit engine) and removes both the cooperative membership and the per-chef
software/API work.

## Key Hypothesis

We believe offering avance immédiate at checkout, transmitted by Labs Food on the chef's behalf,
will raise booking conversion and keep independent chefs on the marketplace instead of
cooperatives, for SAP-eligible households and SAP-declared independent chefs.
We'll know we're right when **X %** of eligible bookings are paid with avance immédiate, checkout
abandonment drops by **Y points**, and chefs save **Z hours/month** of admin — targets **TBD**,
baseline to capture at launch.

## What We're NOT Building

- **AI shopping list / recipe generation** — separate PRD. This one only needs the booking to
  carry service, shopping-fee and grocery amounts as separate lines.
- **Commission rate changes** — stays a config value (`payments.commissionRateBps`); may change later.
- **API Tierce déclaration CESU (mode mandataire)** — chefs are *prestataires*; wrong API.
- **Labs Food acting as a cooperative** — Labs Food only transmits to URSSAF. No membership, no
  invoicing the service in its own name.
- **Deferred or partial payment of the client's 50 % share** — URSSAF handles the client debit.
- **Deposit / cancellation fee charging** — no-show risk accepted for MVP; only a data provision
  (see Should), pending product owner approval. Note: the first *acompte* declared in avance
  immédiate makes a *garantie financière* mandatory (see Open Questions).
- **Cancelling a demande de paiement through the API** — URSSAF offers no cancellation method;
  cancellation is an email to URSSAF (admin procedure, see URSSAF Reference).
- **In-app habilitation / SAP declaration wizard for chefs** — covered by FAQ and blog walkthroughs.

## Success Metrics

| Metric | Target | How Measured |
|--------|--------|--------------|
| Share of eligible bookings paid with avance immédiate vs CB vs e-CESU | TBD | `payments.method` on confirmed bookings of URSSAF-eligible clients |
| Checkout conversion rate | TBD | bookings created → bookings confirmed, split by payment method |
| Checkout abandonment | TBD | bookings left `pending` or cancelled before confirmation |
| Admin hours saved per chef per month | TBD | chef survey at onboarding and at +3 months |
| SAP chefs choosing Labs Food as intermediary vs their cooperative | TBD | `SapProfile` intermediary choice |
| Demande de paiement refusal / unpaid rate (operational) | TBD | statuts 40 / 60 / 120 from polling |

## Open Questions

- [ ] **Confirm with URSSAF that each chef is paid directly** under Labs Food's platform
      habilitation. Product owner decision: the chef is paid. But URSSAF's public service page
      states, for clients of an organisation, that URSSAF pays "votre organisme, qui rémunère
      l'intervenant", and the API doc speaks of a transfer "au prestataire". Confirm in the
      habilitation exchange (habilitation-api@urssaf.fr / avance-immediate@urssaf.fr) before
      phase 4 ships to production.
- [ ] **Per-chef enrolment**: `ERR_NUMINTERVENANT_BLOQUE` means the chef's SIRET must have
      authorised access to avance immédiate. What enrols a chef under Labs Food's habilitation?
- [ ] **Garantie financière** (art. D133-22 CSS): does it apply to Labs Food as the habilitated
      structure? Mandatory from the first *acompte*, or once declared services reach €200,000 in a
      calendar year; URSSAF's filing deadline for existing users is 31/10/2026.
- [ ] **Annual ceiling**: the API does not signal it — no statut or error code in the official
      documentation v1.30.18 or the URSSAF API help centre. How is a demande processed once the
      client's €6,000 credit (€10,000 if disabled) is used up? Ask avance-immediate@urssaf.fr.
- [ ] **Scope of the prefinanced-CESU exclusion**: URSSAF's eligibility rules say an avance
      immédiate client cannot pay invoices with *titres spéciaux de paiement*. Per booking
      (minimum applied here) or for every booking of that client?
- [ ] Deposit / cancellation fee — product owner decision (data provisioned via `mntAcompte`;
      capped at 50 % of the invoice; triggers the garantie financière).
- [ ] Grocery estimate vs actual receipt — how the difference is settled (belongs to the AI
      shopping list PRD, but it moves the card payment here).
- [ ] Cooperative route: how the chef confirms their cooperative was paid, and whether the
      commission is collected the same way.
- [ ] Polling cadence and Railway cron setup (quota: 300 calls/min on 070).

---

## Users & Context

**Primary User — the chef (priority)**
- **Who**: Independent chef, micro-entrepreneur (*entreprise individuelle*), often a woman in her
  mid-40s with little admin experience; already SAP-declared (NOVA) or not yet (Labs Food provides
  FAQ/blog walkthroughs either way); may currently belong to a cooperative.
- **Current behavior**: goes through a cooperative (€39.99/month or 3–15 % commission), or does
  not offer avance immédiate at all (client pays 100 %).
- **Trigger**: a client asks to pay only 50 %, the monthly cooperative fee comes due, or joining Labs Food.
- **Success state**: marks the service delivered in the dashboard; gets paid in full by URSSAF
  4 business days after the client's validation; no forms to fill.

**Secondary User — the household client**
- **Who**: France-resident household eligible for the SAP tax credit.
- **Current behavior**: pays 100 % upfront, recovers 50 % the following fiscal year.
- **Trigger**: booking a chef.
- **Success state**: pays nothing at booking and only 50 % after the service.

**Job to Be Done**
- Chef: When I've just finished cooking at a client's home, I want payment to go through without
  chasing anything or filling in forms, so I can get paid in full within days and focus on cooking.
- Client: When I book a chef, I want to pay nothing upfront and only half the price, so I can try
  the service without worrying about cost.

**Non-Users**
- Chefs not SAP-declared — cannot use avance immédiate until declared; they still sell through CB.
- Professional / business clients — no SAP tax credit.
- Clients living outside France — not eligible.
- Clients URSSAF will not enrol are **still customers**, paying by CB or e-CESU: no income tax
  return filed yet (N-1 or N-2), not the sole SAP declarant of their tax household, APA/PCH
  beneficiaries, blocked URSSAF account, or past the annual ceiling.

---

## Solution Detail

### Core Capabilities (MoSCoW)

| Priority | Capability | Rationale |
|----------|------------|-----------|
| Must | Chef intermediary choice on `SapProfile` (Labs Food / cooperative / none); the Labs Food route requires `type_a_nova`, NOVA/SIRET and admin vetting | The chef is the *prestataire*; `complement2` carries their SIRET or NOVA on every demande |
| Must | Client URSSAF registration at checkout (méthode 010): first registration **or pairing** when the client is already registered elsewhere (same `idClient` returned; client accepts the pairing online) | No demande can be sent before the client accepts |
| Must | Status check (méthode 020); the booking is **confirmed only once the status is `OK / APPAREILLAGE_VALIDE`**, before the service starts | Demande dates must be later than the client's acceptance (`ERR_LIEN_PARTICULIER_PRESTATAIRE`) |
| Must | Avance immédiate at checkout for the service lines, with no upfront payment; e-CESU is not offered on that booking | Core client promise; URSSAF excludes *titres spéciaux de paiement* for avance immédiate clients |
| Must | Booking amount lines: service / shopping fee / groceries. Groceries by CB only; `taxCreditEligibleAmount` excludes groceries | DGFiP: grocery costs are not eligible. Also fixes the current "100 % eligible" rule |
| Must | Chef "service delivered" action → booking `completed` → demande de paiement (050) **and** facture B issued immediately, whether or not URSSAF has been polled | Product owner decision: commission follows delivery |
| Must | Demande built to URSSAF rules: `codeNature` 120, `unite` `HEURE` or `FORFAIT`, `complement2` = chef's SIRET/NOVA, placeholder `idTiersFacturation`, service period within one calendar month and not in the future | Official documentation v1.30.18 |
| Must | VAT on both regimes: *franchise en base* (HT = TTC, TVA 0) and VAT-registered chefs | Product owner decision |
| Must | Status polling (070) → payment settled at statut 70; refusal (40), unpaid (60) and recovery from the chef (120) recorded | URSSAF has no webhooks |
| Must | URSSAF API client: OAuth2 client credentials (Labs Food platform credentials), token cached in Redis, 429 handling | Single platform habilitation; URSSAF quotas |
| Must | Encryption utility (AES-256-GCM, `node:crypto`) for stored client PII | GDPR; no encryption helper exists today |
| Must | GDPR minimisation: client IBAN and place of birth passed through to URSSAF, never stored; keep `idClient`, encrypted birth date (needed on every demande) and status; consent captured at registration; deletion on account deletion | Labs Food never debits the client, so it never needs their IBAN |
| Must | Fiscal attestation shows the total paid, the amounts already advanced (box 7HB) and the provider's SIREN | Attestation requirements since the 2025 tax year |
| Should | Cooperative route: checkout shows "Avance immédiate (crédit d'impôt 50 %) par <coopérative>"; Labs Food does not transmit; chef confirms payment as in the CESU flow | Chefs keep their cooperative if they prefer |
| Should | Deposit provision: a nullable deposit amount forwarded as `mntAcompte` (≤ 50 % of the invoice); no charging, no UI | Keeps the product owner's deposit decision cheap to ship later |
| Could | Brevo notifications (demande sent, 48 h validation reminder) | URSSAF already emails or texts the client |
| Won't | AI shopping list, commission rate change, mandataire CESU API, cooperative model, deposit charging, API cancellation | See "What We're NOT Building" |

### MVP Scope

The Labs Food intermediary route end to end: chef opt-in → client registration or pairing and
status → avance immédiate checkout for the service lines (groceries by card) → booking confirmed
on status `OK` → chef marks delivered → demande de paiement + facture B → polling → payment
settled. Encryption utility, GDPR minimisation and the fiscal attestation ship with it.

### User Flow

1. **Chef setup (once)** — fills the SAP profile (NOVA, SIRET), chooses "Labs Food as
   intermediary", signs the SEPA mandate (existing flow); an admin vets them → avance immédiate enabled.
2. **Client checkout** — picks menu and quantities → sees service / shopping fee / groceries
   lines → chooses "Avance immédiate (crédit d'impôt 50 %) par Labs Food" for the service lines.
3. **First time only** — enters identity, birth details and IBAN → Labs Food registers them (010).
   A new client activates their account from the URSSAF email (link valid 7 days); a client already
   registered elsewhere accepts the pairing with Labs Food → status `OK` (020).
4. **Groceries** (if shopping is delegated) — paid by card → booking confirmed.
5. **Service** — chef cooks at the client's home → marks it delivered → booking `completed` →
   demande de paiement sent (050) and facture B issued.
6. **Payment** — client validates on particulier.urssaf.fr within 48 h, or it is validated
   automatically (statut 30) → client's share debited two clear days later (50) → full amount
   transferred four business days after validation (70) → polling marks the payment `succeeded`.
7. **If the client's debit fails** — statut 60, then URSSAF recovers the amount **from the
   provider** 30 calendar days + 2 business days later (120). The chef bears it; facture B stays due.

---

## Technical Approach

**Feasibility**: MEDIUM — most payment groundwork exists; the risks are the URSSAF confirmations
listed in Open Questions and three changes to the current payment model.

**Architecture Notes**
- Branch `feat/payment-avance-immediat`, created from local `feat/payment-cesu-prefinanced`
  (head `31eb03e`).
- `UrssafService` in `apps/src/integrations/`, config-gated like `StripeService`
  (`configured` flag); Node's built-in `fetch`; OAuth2 token cached through the existing
  `RedisService`; base URL per environment (sandbox `api-edi.urssaf.fr`, production `api.urssaf.fr`).
- `AvanceImmediatePaymentsService` in `apps/src/modules/payments/`, modelled on
  `CesuPaymentsService.declare` (`cesu-payments.service.ts:78`): pending payment plus a pending
  `sepa_direct_debit` commission in one transaction, re-checking vetting and `assertNoCommissionBlock`.
- Commission: `CommissionDebitsService.onCommissionDue` (`commission-debits.service.ts:136`) is
  called at "delivered"; `payments.commissionDebitTrigger` (`on_payment` / `monthly_batch`) still applies.
- Settlement: `settlePayment` stays the only writer of `succeeded`, but takes the eligible amount
  from the payment's lines instead of 100 % (`payment-settlement.ts:53`).
- Booking confirmation: extend the rule at `payment-settlement.ts:71` so a committed avance
  immédiate payment with client status `OK` counts toward confirmation (not toward fiscal totals).
- Polling: admin endpoint called by a Railway cron — same pattern as
  `POST /admin/commission-invoices/run-due` (`commission-invoices.controller.ts:106`).
- Data: `Payment.metadata` (JSONB, reserved for this flow) holds `idDemandePaiement`, statut and
  motif; new storage for the client's URSSAF registration (`idClient` stored lowercase, encrypted
  birth date, status); `SapProfile` gains the intermediary choice.
- Reconciliation: URSSAF puts `numFactureTiers` in the SEPA `ustrd` field of its transfer; use
  the booking reference as the invoice number (≤ 50 characters, unique — `ERR_FACTURE_DOUBLON`).
- Encryption helper under `apps/src/common/`, key from a new env var validated in `env.validation.ts`.
- Chef IBAN is untouched: collected by Stripe Elements (SetupIntent), stored at Stripe; Labs Food
  keeps only Stripe ids and `ibanLast4` (`SepaMandate`).
- API contract: `docs/payments/Contrat API Urssaf.json` (v1.30.14); reference documentation is
  v1.30.18 (see URSSAF Reference below).
- Frontend screens (checkout, chef dashboard) live in `batchcooking-web` and consume these endpoints.

**Technical Risks**

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| URSSAF pays the habilitated structure (Labs Food) rather than the chef | M | Confirm in the habilitation exchange before phase 4 reaches production; if so, pass through via Stripe Connect transfer and review payment-services status |
| Garantie financière required from Labs Food (first acompte, or €200,000/year) | M | Clarify with URSSAF; keep deposits off until it is in place |
| Chef SIRET not authorised for avance immédiate (`ERR_NUMINTERVENANT_BLOQUE`) | M | Clarify the per-chef enrolment step; surface the error to admin vetting |
| Client debit fails → URSSAF recovers the amount from the chef (statut 120) | M | Chef bears it (decision); show the statut in the chef dashboard |
| Late cancellation / no-show with nothing paid upfront | M | Accepted for MVP; `mntAcompte` provision pending product owner |
| Client's URSSAF account not activated before the service date | M | Booking confirmed only on status `OK`; 7-day activation link |
| Leak of client PII (birth details, IBAN) | L | IBAN pass-through, stored PII encrypted, request payloads never logged |
| Groceries counted as tax-credit eligible (**exists today**, `payment-settlement.ts:53`) | H | Fixed in phase 1 |
| Missed or delayed polling | L | Idempotent poll endpoint; cron cadence TBD |

---

## URSSAF Reference (official documentation v1.30.18, 29/12/2025)

**Demande de paiement fields**
- `codeNature` **120** — "Préparation de repas à domicile, y compris le temps passé aux courses".
  `codeActivite` is optional and there is none for 120.
- `unite`: `HEURE` or `FORFAIT`.
- `complement2` (chef): `SAP` + 9-digit SIREN (12 characters) or `SIR` + 14-digit SIRET (17 characters).
- `idTiersFacturation`: mandatory in the contract but unused — send a placeholder value.
- `dateDebutEmploi` / `dateFinEmploi` in the same calendar month; all dates later than the
  client's activation or pairing acceptance (date and time) and not in the future.
- Amounts with 2 decimals (3 for `mntUnitaireTTC`); line totals must match the invoice within €0.05.
- `mntAcompte` ≤ 50 % of the invoice; `dateVersementAcompte` required when set.
- Maximum 10 demandes per call.

**Demande de paiement statuts**

| Code | Statut | Meaning |
|------|--------|---------|
| 10 | Intégrée | Received and passed consistency checks |
| 20 | En attente de validation | Client notified; must validate or refuse |
| 30 | Validée | Validated by the client, or automatically after 48 h; debit cycle starts |
| 40 | Refusée | Refused by the client with a reason code |
| 50 | Prélevée | Client's share debit launched (debit two clear days after validation) |
| 70 | Payée | Transfer to the provider launched (four business days after validation) |
| 60 | En refus de prélèvement | Client debit returned in error — unpaid |
| 110 | Annulée | Cancelled at the provider's reasoned request |
| 111 | Annulée après impayé | Cancelled after the client's unpaid |
| 112 | Annulée après recouvrement | Cancelled after recovery from the provider |
| 113 | Annulée pour raison spécifique | Not currently available |
| 120 | Recouvrée | Unpaid recovered from the provider (30 calendar days + 2 business days after statut 60) |
| 260 | Impayé prestataire | Recovery debit on the provider returned in error |
| 270 | Régularisé prestataire | Provider's unpaid regularised |

**Transmission statuts (méthode 020)**: `OK APPAREILLAGE_VALIDE` (demandes allowed from the
acceptance date) · `KO APPAREILLAGE_EC` (pairing being processed) · `KO APPAREILLAGE_NF` (pairing
not finalised — client action needed) · `KO PARTICULIER_BLOQUE` (client account blocked) ·
`KO MANDAT_ECHU` (client's debit mandate expired or expiring).

**Registration (méthode 010)**: one client per call; the client must be known to the DGFiP with a
taxed period. A client already registered with another provider is only **paired**: URSSAF keeps
their existing bank and contact details (they update them online) and returns only `idClient` —
the same one when the identity data matches. Key errors: `ERR_DGFIP_R2P_INCONNU` (identity not
matched), `ERR_DGFIP_IMPOTPART_INCONNU` (no taxed period — retry after 1 August or 1 January),
`ERR_COMPTE_BLOQUE` (blocked account), `ERR_CONTACT` (e.g. email shared by two household members).

**Other demande errors to map**: `ERR_LIEN_PARTICULIER_PRESTATAIRE`, `ERR_CMPT_BLOQUE`,
`ERR_MANDAT_ECHU`, `ERR_NUMINTERVENANT_BLOQUE`, `ERR_FORMAT_NUMINTERVENANT`,
`ERR_PERIODE_EMPLOI_MOIS_NON_UNIQUE`, `ERR_DATE_FUTUR`, `ERR_TOTAL_PRESTATIONS`,
`ERR_MNT_PREST_TTC`, `ERR_MNT_PREST_HT_TVA`, `ERR_CODE_NATURE`, `ERR_FACTURE_DOUBLON`,
`ERR_MONTANT_ACOMPTE`, `ERR_NBRE_PREST_MAX`.

**Quotas**: 010 — 100 calls/min · 020 — 300/min · 050 — 150/min · 070 — 300/min; HTTP 429 beyond.
`idClient` must be sent lowercase to 020. A 401 on the OAuth token can occur during the first
24–48 h after receiving credentials.

**Cancellation**: not available in the API — email URSSAF with the SIRET, invoice number, demande
number, client name and reason; if the client was already debited and the provider paid, URSSAF
regularises within six days.

**Client eligibility (URSSAF service page, updated 03/08/2026)**: address in France; sole SAP
declarant of the tax household; tax number; at least one income tax return (N-1 or N-2); no
APA/PCH funding; no *titres spéciaux de paiement* for invoices. Ceiling: €6,000 of credit per year
(€12,000 of expenses), €10,000 for disabled clients; beyond it, expenses are no longer eligible.

---

## Implementation Phases

<!--
  STATUS: pending | in-progress | complete
  PARALLEL: phases that can run concurrently (e.g., "with 3" or "-")
  DEPENDS: phases that must complete first (e.g., "1, 2" or "-")
  PRP: link to generated plan file once created
-->

| # | Phase | Description | Status | Parallel | Depends | PRP Plan |
|---|-------|-------------|--------|----------|---------|----------|
| 1 | Foundations | Encryption utility, schema (client URSSAF registration, intermediary choice, booking amount lines, deposit provision), eligible-amount fix | pending | with 2 | - | - |
| 2 | URSSAF API client | OAuth2 + méthodes 010 / 020 / 050 / 070, typed against the contract, error and statut mapping, tested in sandbox | pending | with 1 | - | - |
| 3 | Client registration & checkout | Registration / pairing + status endpoints, avance immédiate commitment, confirmation on status `OK`, groceries by card, no e-CESU on the booking | pending | - | 1, 2 | - |
| 4 | Delivered → demande + facture B | Chef "service delivered" endpoint, booking `completed`, demande de paiement, commission invoice | pending | with 6 | 3 | - |
| 5 | Polling & settlement | Poll endpoint + cron, statut → settle / refused / unpaid / recovered | pending | - | 4 | - |
| 6 | Cooperative route & fiscal attestation | "par <coopérative>" label and chef confirmation; attestation with 7HB amounts and SIREN | pending | with 4 | 3 | - |

### Phase Details

**Phase 1: Foundations**
- **Goal**: Data and security groundwork every later phase writes into.
- **Scope**: AES-256-GCM helper + env key; migration for client URSSAF registration, `SapProfile`
  intermediary choice, booking amount lines (service / shopping fee / groceries), nullable deposit
  amount; `settlePayment` eligible amount excluding groceries.
- **Success signal**: Migration applies idempotently; encryption round-trip test passes; a grocery
  card payment no longer counts toward the fiscal attestation.

**Phase 2: URSSAF API client**
- **Goal**: A tested client for the four URSSAF methods.
- **Scope**: `UrssafService` with OAuth2 client credentials, token caching and 429 handling; 010,
  020, 050, 070 mapped to the contract's DTOs; statut and error-code mapping from the URSSAF
  Reference; no logging of request payloads.
- **Success signal**: Sandbox calls succeed for each method; unit tests cover token refresh,
  error mapping and the demande builder (nature 120, same-month period, `complement2` format).

**Phase 3: Client registration & checkout**
- **Goal**: A client can choose avance immédiate and get a confirmed booking without paying.
- **Scope**: Registration / pairing endpoint (IBAN pass-through, consent), status endpoint, avance
  immédiate commitment for the service lines, confirmation on status `OK`, groceries by card,
  e-CESU hidden on that booking.
- **Success signal**: End-to-end test — a client with status `OK` confirms a booking with €0 paid
  for the service lines; a client with `KO` status cannot.

**Phase 4: Delivered → demande + facture B**
- **Goal**: One chef action triggers everything admin-related.
- **Scope**: Chef "service delivered" endpoint; booking → `completed`; demande de paiement (050)
  with the chef's SIRET/NOVA; `onCommissionDue` issues facture B immediately.
- **Success signal**: Marking delivered sends the demande and issues facture B in one flow;
  idempotent on retry (`ERR_FACTURE_DOUBLON` treated as already sent).

**Phase 5: Polling & settlement**
- **Goal**: Payment state follows URSSAF without manual work.
- **Scope**: Admin poll endpoint (070) called by Railway cron; statut 70 → `settlePayment`;
  40 / 60 / 120 recorded in `Payment.metadata` and shown to the chef.
- **Success signal**: A paid demande moves the payment to `succeeded`; refused and unpaid demandes
  are visible to the chef and admins.

**Phase 6: Cooperative route & fiscal attestation**
- **Goal**: Cooperative chefs are served, and attestations are correct.
- **Scope**: Checkout label "par <coopérative>", chef confirmation of cooperative payment (CESU
  pattern); fiscal attestation shows the total, the amounts advanced (7HB) and the provider's SIREN.
- **Success signal**: A cooperative-routed booking completes without any URSSAF call from Labs
  Food; attestation totals reconcile with URSSAF amounts.

### Parallelism Notes

Phases 1 and 2 touch disjoint code (schema and common utilities vs a new integration) and can run
together. Phase 3 needs both. Phase 6 only depends on the checkout work in phase 3, so it can run
alongside phase 4. Phase 5 needs demandes to exist (phase 4). The URSSAF confirmations in Open
Questions (payee, per-chef enrolment, garantie financière) should be settled during phase 2's
sandbox work, before phase 4 goes to production.

---

## Decisions Log

| Decision | Choice | Alternatives | Rationale |
|----------|--------|--------------|-----------|
| Role of Labs Food | Habilitated platform transmitting to URSSAF for chefs (*mode prestataire*) | Cooperative model; each chef with own software | Remove the admin load without cooperative membership; Labs Food is not a cooperative |
| Habilitation | Filed by Labs Food as a platform (already initiated) | One habilitation per chef | Single integration and one set of credentials |
| Who URSSAF pays | The chef, directly | Labs Food, then a transfer to the chef | Product owner decision; to confirm with URSSAF (Open Questions) |
| Contested, refused or unpaid demande | The chef bears it; facture B is not credited back | Credit note; Labs Food absorbs | Product owner decision; matches URSSAF recovering unpaids from the provider (statut 120) |
| Booking confirmation | Only once the client's URSSAF status is `OK` | At commitment | Demande dates must follow the client's acceptance |
| Validation window | Tacit validation after 48 h | - | Confirmed by URSSAF (statut 30) |
| Payment method placement | Third method next to CB and e-CESU | Replace CB | Ineligible clients keep paying by CB or e-CESU |
| Eligible services | Only cooking at the client's home — nature code 120 | Deliveries from the chef's kitchen | DGFiP: only labour at the client's home is eligible |
| Groceries | CB only at checkout | e-CESU for groceries | Prefinanced CESU pays SAP services only; groceries are not eligible |
| e-CESU on an avance immédiate booking | Not offered | Mixed payment | URSSAF excludes *titres spéciaux de paiement* for avance immédiate clients |
| Commission timing | Facture B issued as soon as the chef marks delivered, whether or not URSSAF has been polled | After URSSAF payment | Product owner decision — kept as is |
| Commission rate | Out of scope, config value | Lower rate for avance immédiate | May change later |
| Cooperative chefs | Choose their cooperative or Labs Food; checkout shows "par <coopérative>" | Exclude them | Keep chefs who already have a cooperative |
| VAT | Both *franchise en base* (HT = TTC) and VAT-registered chefs | Franchise only | Product owner decision |
| Fiscal attestation | Must: total, amounts advanced (7HB), provider SIREN | Should | Compliance requirement confirmed |
| URSSAF codes | Taken from the official documentation v1.30.18 | Vendor help pages | Verified source |
| Client IBAN and place of birth | Passed through to URSSAF, never stored | Store encrypted | GDPR minimisation; Labs Food never debits the client |
| Chef IBAN | Stays at Stripe (SetupIntent); only `ibanLast4` stored | Store in Postgres | Existing `SepaMandate` design |
| Encryption | Add an AES-256-GCM utility (`node:crypto`) | pgcrypto in the database | Requested; standard library, no new dependency |
| No-show / cancellation | Risk accepted for MVP; `mntAcompte` provision | Deposit now | Pending product owner approval |
| Base branch | `feat/payment-avance-immediat` from `feat/payment-cesu-prefinanced` | Wait for the merge | Don't block on the CESU merge |
| AI shopping list | Separate PRD | Include here | Large, independent feature |

---

## Research Summary

**Market Context**
- SAP cooperatives are the registered provider: they invoice the client, receive URSSAF funds,
  pay the member within 24–72 h after their fee, and issue annual attestations. Pricing is a flat
  subscription (Unipros €39.99/month, no commission) or a 3–15 % commission (most ~10–12 %).
- Invoicing software (Abby, NeedMe, Evoliz, Axonaut…) costs €0–42/month, but each chef files
  their own habilitation (3–7 weeks).
- URSSAF runs two distinct APIs: *Tiers de prestation* (mode prestataire, including platforms
  connecting clients and auto-entrepreneurs) and *Tierce déclaration CESU* (mode mandataire).
- Advanced amounts are pre-filled in box 7HB of the client's tax return.
- Eligibility: *préparation de repas à domicile*, including shopping time, is eligible; grocery
  costs and cooking outside the client's home are not.
- Sources: [URSSAF – Documentation API Tiers de prestation v1.30.18](https://cedito-medias.urssaf.fr/medias/PortailAPI/files/documentationAPIs/TP/Documentation-API-TiersPrestation_v1.30.18.pdf) ·
  [URSSAF API help centre – Support métier et API TP](https://portailapi.urssaf.fr/fr/centre-assistance/article/api-tp-faq) ·
  [URSSAF – Le service Avance immédiate](https://www.urssaf.fr/accueil/services/services-particuliers/service-avance-immediate.html) ·
  [Unipros – offre](https://unipros.coop/notre-offre/) ·
  [MicroChrono – coopératives SAP](https://microchrono.fr/blog/facturer-cooperative-sap-avance-immediate-credit-impot/) ·
  [Accès SAP – FAQ](https://www.acces-sap.com/professionnels/foire-aux-questions/) ·
  [MDSAP – avance immédiate](https://blog.mdsap.fr/avance-immediate-du-credit-dimpot-pour-les-services-a-la-personne-cest-quoi/) ·
  [independant.io – logiciels compatibles](https://independant.io/logiciel-api-tiers-prestation-avance-immediate/) ·
  [Sinao – FAQ API Urssaf](https://help.sinao.fr/fr/articles/6326657-faq-api-urssaf-avance-immediate) ·
  [Sinao – déclarer l'avance immédiate](https://help.sinao.fr/fr/articles/9335123-comment-aider-mon-client-a-declarer-l-avance-immediate-et-les-credits-d-impot-percus) ·
  [BOFiP BOI-IR-RICI-150-20](https://bofip.impots.gouv.fr/bofip/3968-PGP.html/identifiant=BOI-IR-RICI-150-20-20170920)

**Technical Context**
- On `feat/payment-cesu-prefinanced`: `PaymentMethod.avance_immediate`, `Payment.metadata`
  reserved for this flow, `Payment.taxCreditEligibleAmount`, `SapProfile` (declaration type,
  NOVA code, `urssafTiersPrestationStatus`, `cooperativeName`), the facture B + SEPA
  commission-debit engine, per-chef fiscal attestations, `BookingStatus.completed` (never set today).
- URSSAF contract v1.30.14 in the repo: 4 methods (010 register client, 020 client status,
  050 demande de paiement, 070 search demandes); OAuth2 client credentials, scope
  `homeplus.tiersprestations`; no webhooks.
- Gaps: booking confirmation requires fully `succeeded` payments; no "service delivered" action;
  no grocery or shopping-fee amounts; 100 % of every payment marked eligible; no scheduler; no
  encryption utility; existing integrations make no outbound HTTP calls besides the Stripe SDK.

---

*Generated: 2026-09-18 · Updated: 2026-09-18 (URSSAF reference values, product owner answers)*
*Status: DRAFT - needs validation*
