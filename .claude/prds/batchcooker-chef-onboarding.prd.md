# Onboarding batch cooker — candidature, KYC et validation admin

> Source of truth for behaviour: [`FLOW-01-candidature-batch-cooker.md`](../../../batchcooking-web/docs/api/FLOW-01-candidature-batch-cooker.md) (in `batchcooking-web`).
> This PRD states *what must be true*; `/plan` decides *how*.
> Companion PRD (separate branch): plats, menus et modération — [`FLOW-02`](../../../FLOW-02-plats-et-menus.md).

## Problem

Today a batch cooker becomes a chef by signing up as a client and calling `PATCH /me/chef-profile`,
which promotes their own role. An admin then flips two booleans, `is_verified` and `is_active`, with
no record of *what* was verified. There is no candidature, no identity document, no proof of
registration, no insurance certificate — and no way for an admin to have seen any of them.

Lab's Food places a stranger in a client's kitchen. Selling that service in France under the
service-à-la-personne regime requires holding and checking identity, registration and insurance
documents. The current flow cannot produce that evidence, so every activated chef is an
unevidenced trust decision, and every candidate is invisible between "interested" and "active".

## Evidence

Qualitative only — no funnel instrumentation exists yet, so there are no numbers to cite.

- The `/devenir-chef` confirmation screen currently tells candidates their credentials are being
  sent immediately. That is false under any vetted flow, and was flagged for correction
  (FLOW-01 §9.1) — evidence the current path was never designed as a real onboarding.
- `requiredDocuments()` and the region reference list live hard-coded in the frontend
  (FLOW-01 §9.2, §9.4), so document requirements today are a client-side suggestion that no
  server enforces.
- `PATCH /admin/chefs/:id/verification` accepts `isVerified: true` with no precondition. Nothing
  in the system can distinguish a vetted chef from one an admin clicked by mistake.
- FLOW-01 and FLOW-02 were written and decided on 20/09/2026 with both flows specified end to
  end, including error codes and retention periods — the design work is done, the backend is not.

**Assumption needing validation**: that candidate drop-off during document collection is material.
No instrumentation exists to measure it. The funnel metric below is instrumented precisely so this
assumption can be tested against the first cohort.

## Users

- **Primary — the candidate batch cooker.** Applies from the public site; submitting creates their
  account, which stays browse-only until approved. Typically a micro-entrepreneur, sometimes not yet registered,
  sometimes on a residence permit. Gathers scans over days, not minutes, often on a phone. Needs
  to leave and come back without losing the dossier.
- **Primary — the Lab's Food admin.** Works a review queue, opens identity documents, accepts or
  refuses each one with a written reason, and decides. Owns the « réponse sous 48 h ouvrées »
  promise made to candidates.
- **Secondary — the approved batch cooker.** Keeps a living dossier: documents expire, must be
  renewed, and their storefront depends on the dossier staying valid.
- **Not for**: clients, admin self-service account creation, or any chef recruited outside the
  public candidature path. There is exactly one way to become a chef.

## Hypothesis

We believe **a candidature whose dossier is built from a browse-only account before approval, with
server-derived document requirements and a written decision on every document**, will **let Lab's Food prove why
each chef was approved and let candidates complete a dossier over several sessions**, for
**candidate batch cookers and the admins who vet them**.

We'll know we're right when **a majority of submitted candidatures reach a decision rather than
being abandoned mid-dossier, and no active chef exists without a validated identity document.**

## Success Metrics

| Metric | Target | How measured |
|---|---|---|
| **Funnel completion** (primary) | ≥ 60% of submitted candidatures reach `approved` or `rejected` rather than expiring | Count by terminal status over candidatures submitted ≥ 30 days ago |
| **Decision SLA** (secondary) | ≥ 90% of dossiers get a first admin document decision within 48 working hours | `submittedAt` → first document decision timestamp |
| **Unevidenced chefs** (guardrail) | **0** — no chef profile is `isVerified` without a `valid` blocking document set | Invariant check; approval is refused rather than counted |
| **Document rejection rate** | baseline only, no target | Grouped by `reasonCode`, to find which documents candidates get wrong |

Targets on the first two are first estimates with no baseline behind them. They exist to be
calibrated against the first real cohort, not defended.

## Constraints already decided

Decisions taken before planning; `/plan` works inside them rather than reopening them.

| Decision | Rationale |
|---|---|
| **Submitting a candidature creates the account**, browse-only until approval (decided 21/09/2026, reversing FLOW-01 §1) | The candidate works signed in from their dashboard instead of through a scoped link, which removes the candidate token, its resend endpoint and the account creation at approval. Unverified means the candidature, its documents and the profile photo (added 03/10/2026) are the only things the account can act on, enforced in the API. A refused candidate keeps the account, sees the reason and the reapply date, and reapplies from it. |
| Public account creation proves the inbox before anything can happen | The Clerk user has no password and the sign-in link goes only to the submitted address, never into the response, so submitting someone else's address creates an account nobody can open. An address that already has an account is refused and nothing is attached to it. |
| **Verification comes only from approval** | Every candidate holds a chef profile, so the admin flag endpoint refuses `isVerified: true` until the candidature is approved — otherwise it would skip the document check. |
| Client→chef **self-promotion is removed**; `PATCH /me/chef-profile` stays as **update-only self-edit** | Two routes to becoming a chef, one unvetted, contradicted the whole premise. The route survives so an approved batch cooker can still edit their own `displayName`, `bio`, `city` and radius — but it never creates a profile and never changes a role, so a client calling it gets a 404, and a candidate awaiting approval a 403. |
| KYC files live in **Supabase Storage**, private bucket, signed upload and read | Already a configured dependency with a service-role key. At projected volume (~15 MB/chef) storage cost is noise; the egress-price gap that favours object-storage vendors only matters for public high-traffic files, which KYC documents never are. Revisit for dish photos in FLOW-02. |
| Transactional email via **Brevo hosted templates** | Copy is French, candidate-facing, and includes refusal reasons — marketing must be able to change wording without a deploy. Template IDs become configuration. |
| Expiry and retention run as a **daily in-process scheduled job** | No queue infrastructure exists and none is warranted at this scale. Known ceiling: double-fires under multiple API replicas. |
| Document requirements are **computed server-side** from the candidate's answers | Today the frontend decides what is required, so nothing is actually required. |
| Dossier status is **derived, never stored as input** | An admin cannot type a dossier into `validated`; it follows from the documents. |
| Automatic suspension lifts **on deposit**, not on review | FLOW-01 §7 promises the only unattended takedown is "réversible immédiatement". The replacement is flagged for priority review and a refusal re-suspends, so speed for the chef does not become a hole in vetting. |
| A candidate **corrects their answers** until a decision; an answer a **validated document proves is locked** (decided 03/10/2026) | Otherwise a typo needs a refusal and a reapplication, and an unregistered candidate can never leave `awaiting-registration`. The lock keeps each admin decision tied to the answer it was made against: changing a name or a SIRET first takes a new version of the document proving it. Email and consent never change. |

## Scope

**MVP** — the full FLOW-01 path, candidature to living dossier:

- Public candidature submission with server-side validation (SIRET Luhn check, SAP declaration
  format, intervention zones, conditional work-authorisation proof, consent capture) and
  server-computed document requirements.
- The account created at submission, reached through a single-use sign-in link sent to the
  submitted address. Until approval it can read its candidature and handle its documents, nothing
  else.
- Document deposit by signed upload, three calls, file never transiting the API. Re-deposit
  creates a version; previous versions and refusal reasons survive.
- Admin review: queue sorted by waiting time, per-document accept/refuse with a mandatory written
  reason, "request changes" without refusing, signed short-lived read URLs with an audit trail of
  who opened which document.
- Approval as a single transaction that verifies the existing account and copies the answers onto
  the chef profile — refused outright if any blocking document is not valid.
- Refusal with reason and optional re-application date. The account stays, browse-only, and can
  reapply from that date.
- Living dossier for approved chefs: same deposit flow, version history, expiry warnings,
  automatic suspension when a blocking document expires, automatic reactivation on a valid
  re-deposit, and retention purge on the FLOW-01 §8 schedule.
- `GET /me` answering fast enough and for inactive chefs, so the shared sign-in page can route a
  batch cooker to the right space.

**Out of scope**

- **Plats, menus, modération, vitrine publique (FLOW-02)** — its own PRD and its own branch. This
  PRD ships the `isVerified` gate FLOW-02 depends on, nothing more.
- **Real SIRET existence check against INSEE Sirene** — form and Luhn validation only. Flagged in
  FLOW-01 §10.1 as a separate improvement; it changes the refusal rate, not the flow.
- **Merging a client account into a chef account** — a client who applies with an existing address
  is refused with `EMAIL_ALREADY_USED`. A client ↔ chef switcher was analysed and found cheap on the
  backend; the decision is pending and it would ship with a self-dealing guard on bookings.
- **`approval` and `criminal-record` document types** — exist in the reference list, no screen
  triggers them, and the policy for vulnerable-public work is not settled (FLOW-01 §10.4).
- **Automated candidate reminders** — the cadence is undecided (FLOW-01 §10.3). Expiry alerts for
  *approved* chefs are in scope; nudging *candidates* who stall is not.
- **Separate marketing consent** — the RGPD consent collected covers processing the dossier only.
  Re-contacting refused candidates needs its own consent and its own decision.
- **Frontend changes** — FLOW-01 §9 lists five, including the false confirmation-screen copy. They
  belong to the `labs-food` repo and are tracked there.

## Delivery Milestones

| # | Milestone | Outcome | Status | Plan |
|---|---|---|---|---|
| 1 | Candidature accepted | A batch cooker submits from the public site, gets a reference, and receives a sign-in link to a browse-only account. The server decides which documents their answers require. | pending | — |
| 2 | Dossier completable | The candidate signs in and deposits documents through signed uploads. Re-depositing versions rather than overwrites. The dossier status follows from the documents. | pending | — |
| 3 | Dossier reviewable | An admin works a queue sorted by waiting time, accepts or refuses each document with a written reason the candidate reads verbatim, or requests changes without refusing. Every document opened is logged. | pending | — |
| 4 | Decision verifies the account | Approval turns the browse-only account into a verified chef in one transaction, and is refused if any blocking document is unvalidated. Refusal leaves the account browse-only with the reason and the reapply date. Self-promotion to chef no longer exists. | pending | — |
| 5 | Dossier stays alive | Approved chefs are warned before documents expire, suspended automatically when a blocking one lapses, reactivated on a valid re-deposit, and purged on the retention schedule. | pending | — |

Milestones 1–4 are the testable hypothesis. Milestone 5 is what keeps it true past the first
renewal cycle.

## Open Questions

- [ ] **Retention purge scope** — FLOW-01 §8 gives durations but not whether purge deletes the
      stored files, the database rows, or both. Deleting a dossier an admin approved may conflict
      with the "contract + 5 years" obligation on the chef's own documents.
- [ ] **Candidate reminder cadence** (FLOW-01 §10.3) — after how many silent days is a candidature
      dormant, short of the 6-month abandonment purge?
- [ ] **Who counts as an admin reviewer** — the audit trail records *which* admin opened an
      identity document. Is a single `admin` role enough, or does document access need to be
      narrower than "any admin"?
- [x] **Reactivation after automatic suspension** — settled 21/09/2026: the
      storefront returns on deposit, the replacement jumps the review queue, and
      a refusal re-suspends. FLOW-01 §7's two sentences disagreed; this honours
      "réversible immédiatement" without leaving an unreviewed document live
      indefinitely.
- [ ] **Vulnerable-public documents** (FLOW-01 §10.4) — when does that option open, and does it
      change the blocking set retroactively for already-approved chefs?
- [ ] **Working-hours definition for the 48h SLA** — the promise is « 48 h ouvrées ». French public
      holidays and weekends need a definition before the metric can be computed.
- [ ] **Frontend cutover** — `PATCH /me/chef-profile` keeps working for existing batch
      cookers, but a *client* who calls it to become a chef now gets a 404. Does the
      frontend's "devenir chef" path move to the candidature first, or simultaneously?

## Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Submission partially completes — account created in Clerk with no database row | Medium | High — an orphaned identity with no profile, and an address that can no longer apply | Everything that can fail runs before the database commit, in one transaction; any failure deletes the Clerk user |
| A public endpoint that creates accounts is abused — someone applies with another person's address | Medium | Medium — an unwanted account and one email to the victim | No password on the account and the link only in that inbox, so nobody else can open it; an address already in use is refused; 5 submissions per hour per IP |
| Identity documents leak through a mis-scoped or long-lived read link | Low | Severe — RGPD breach on identity papers | Private bucket, no public read, short-lived read links, audit trail on every read, documents reachable only by their own signed-in account and by admins |
| Removing self-promotion breaks the live frontend | Medium | Medium — a client trying to become a chef through the old path hits a 404 | Narrowed by keeping the route for existing chefs' self-edit, so only the promotion call breaks; coordinate that cutover explicitly (open question above) |
| Automatic suspension pulls a working chef's storefront offline | Medium | High — lost bookings and a chef who does not know why | The only unattended removal in the system: warn at J-60/J-30/J-7, state the cause in the email, reactivate automatically on a valid re-deposit |
| Candidates abandon during document collection | Medium | High — the funnel metric is the hypothesis | Candidature submits with zero documents by design; only blocking documents gate approval; the candidate returns by signing in, with no link to lose |
| Scheduled job double-fires under multiple API replicas | Low now, High after scaling | Medium — duplicate expiry emails | Accepted ceiling at current scale; make the job idempotent so a double run is harmless, and revisit when a second replica is added |
| `GET /me` too slow, batch cookers land in the client space | Medium | Medium — visibly broken sign-in for chefs | The frontend gives up after 6 seconds and falls back to the client space; role resolution must be a fast, single read |

---
*Status: DRAFT — requirements only. Implementation planning pending via /plan.*
