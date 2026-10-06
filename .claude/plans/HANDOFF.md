# Handoff — chef onboarding (FLOW-01) and dishes/menus (FLOW-02)

> Written 21/09/2026 before a context compaction. Everything needed to resume is
> here or in the files it points to. Worktree:
> `LF-BackEnd/.claude/worktrees/batchcooker-chef-onboarding-47b85c`.

## Standing rules (from the user — do not break)

- **Never write to the database or apply a migration** unless explicitly asked.
  Read-only only; prefer Supabase MCP tools over Docker. Docker Postgres is unreliable.
- **Commit and push only when asked.** Push explicitly to the named remote branch —
  several branches were created tracking `origin/develop`.
- **No attribution** in commits or PRs ("don't tag your print on it").
- `gh` is not installed. PRs are created/edited via the GitHub API using the git
  keychain credential; never print the token.
- **`batchcooking-web` and `labsfood-web` are read-only** unless the user explicitly
  asks for a change in that repo. Report stale frontend docs; never edit them.
- Ponytail: shortest correct diff, reuse before writing, no speculative abstraction.

## Branches and PRs

| Branch | PR | Base | State |
|---|---|---|---|
| `feat/batchcooker-chef-onboarding` | [#37](https://github.com/LabsFood/LF-BackEnd/pull/37) draft | `develop` | FLOW-01 implementation, account-at-submission rework included. Pushed head `1044147` |
| `chore/api-docs-and-cms-removal` | [#40](https://github.com/LabsFood/LF-BackEnd/pull/40) | `feat/batchcooker-chef-onboarding` | Swagger pass + CMS removal. Head `314d843`. Retarget to `develop` after #37 merges |
| `feat/chef-dishes-menus` | [#38](https://github.com/LabsFood/LF-BackEnd/pull/38) | `develop` on GitHub; **retarget to `chore/api-docs-and-cms-removal` when pushing** | FLOW-02 PRD **and implementation**. Pushed head `0b162dc`: #40 merged in (`17e02c5`, and squash `acf8a65` on GitHub), milestones 1–8 one commit each, docs, the Clerk deletion fix (`f0fcba5`), the anonymisation that replaces it (`7fb48a4`) and its two ponytail notes (`0b162dc`). Base not retargeted |
| `feat/chef-dishes-menus-impl` | — | cut from #37 at `defd04f` | Stale, unused: the user chose to implement on #38's branch. Leave it |

Local `graphify-out/` is untracked and must never be committed.

## Next task — rework #37: the account exists from candidature submission

**Plan (Gate 1 approved 22/09/2026, bookings left open):**
[`rework-37-account-at-submission.md`](rework-37-account-at-submission.md). It
supersedes the deletion list below where they differ — notably, the migration
**was applied on DEV** (checked 21/09/2026), so the rework stacks
`20260922120000_chef_account_at_submission` instead of editing it in place.

**Status 22/09/2026: pushed.** #37 head `20107f9` (rebased on the user's
`bbbd17b`, which makes lint ignore `src/generated`). Build green, 338/339 tests
(known `registerClient` failure only), lint clean. Review findings fixed before
the push; PR #37 description replaced. Still open:
- Migration `20260922120000_chef_account_at_submission` is **not applied** on DEV —
  the user's call.
- The FLOW-01 doc edit made in `batchcooking-web` was reverted by the user on
  23/09/2026; that repo is read-only for this work. `FLOW-01-candidature-batch-cooker.md`
  there still describes the old token flow — report it, do not edit it.
- Plan [`api-docs-and-cms-removal.plan.md`](api-docs-and-cms-removal.plan.md) done
  and **pushed 24/09/2026**:
  - `feat/batchcooker-chef-onboarding` (#37) head `1044147`: document-type enum in Swagger.
  - `chore/api-docs-and-cms-removal` →
    [#40](https://github.com/LabsFood/LF-BackEnd/pull/40), **base #37's branch**:
    `ee467f4` CMS removal (migration `20260923120000_remove_cms_pages`, **not
    applied**), `314d843` Swagger pass over all 52 routes. Retarget #40 to `develop`
    once #37 merges; the Docker CI workflow only runs on PRs into `develop`.
  - A separate session is fixing `GET /bookings` (admin guard) from `develop`; it
    touches the same `list()` decorators as `314d843`, so expect a small conflict.
  - Documented as-is, for the user to decide: meal `ingredients` refuses a list
    (`@IsObject`) though shopping lists need one; menu weeks cannot be published by
    any route; quote accept works from any status; bad `status` values on quotes and
    clients, and unknown ids on PATCH meals/formules/quotes/clients, give 500;
    `/bookings/me/bookings/{id}` paths; document status `reviewing` never set.
- Next: recreate `feat/chef-dishes-menus-impl` from #37, then FLOW-02 milestone 1.

The user reversed FLOW-01 §1 ("le compte n'existe pas avant l'étape 4") and asked to
**simplify decision #2** (the opaque candidate token).

**Decided (21/09/2026)**

- **Submitting a candidature creates the account.** `POST /chef-applications` stays
  public and creates the Clerk user. **Must pass a security review** — run the
  `security-review` skill during implementation.
- The new account is a chef with `isVerified: false`, `isActive: false`: a
  **browse-only dashboard**. The only actions allowed are submitting the candidature
  and handling documents. Enforce on the backend, not only in the UI.
  - `PATCH /me/chef-profile` (self-edit) is **blocked** until verified — the user's
    wording is "no action except documents and application".
  - FLOW-02 publishing already refuses unverified chefs (`CHEF_NOT_VERIFIED`).
- **Refused candidature:** the account stays, showing the refusal reason and the
  reapply date. Documents still purged at 3 months (FLOW-01 §8).

**Pending decision — client ↔ chef switcher**

See [`dual-role-switcher-analysis.md`](dual-role-switcher-analysis.md). Feasible and
cheap on the backend; the user will decide. Until then do not remove
`assertNoConflictingProfile`.

**What the rework deletes from #37** (the simplification)

- Opaque candidate token: `services/application-token.ts` (+ spec),
  `application-token.guard.ts`, `current-application.decorator.ts`.
- `POST /chef-applications/:id/resend-link` and its rate limiting.
- `chef_applications.token_hash`, `token_expires_at`, `resend_count`,
  `resend_window_started_at` — the migration is unapplied anywhere real, so edit
  `20260920120000_chef_onboarding` in place rather than stacking a new one. Confirm
  with the user first if any shared environment ran it.
- Approval's Clerk-user creation, the compensating delete, and the magic link.
  Approval reduces to setting `isVerified` (and `isActive` per the body).
- The approval-time document hand-over: documents can belong to the chef profile
  from the first upload.

**Security requirements for public account creation** (must hold)

- An email that already has an account must **never** gain a chef profile from an
  unauthenticated request. Refuse and ask the holder to sign in — otherwise it is
  an account-takeover path. Applies whether or not the switcher is adopted.
- Throttle the endpoint (existing `ThrottlerGuard`). No account enumeration: the
  response for "email already registered" must not reveal account details.
- Clerk must verify the email before the account can act.
- Every privileged field stays out of the request body; the ValidationPipe already
  runs `forbidNonWhitelisted`.

**Docs to update in the same change:** `FLOW-01-candidature-batch-cooker.md` §1, §4,
§6 now contradict the implementation; the FLOW-01 PRD's constraints table; AGENTS.md
*Chef onboarding*; the #37 PR description.

## Ponytail debt (todo)

- [ ] **Client ↔ chef switcher — not applied, decision pending.** One profile per
  account for now: an existing client cannot become a batch cooker without a second
  account. Marked with a `ponytail:` comment on `assertNoConflictingProfile`
  (`users.service.ts`). Upgrade path and risks in
  [`dual-role-switcher-analysis.md`](dual-role-switcher-analysis.md); it must ship
  with the self-dealing guard on bookings and quotes.

## FLOW-02 — implemented locally on `feat/chef-dishes-menus` (not pushed)

Design: [`chef-dishes-menus.architecture.md`](chef-dishes-menus.architecture.md);
chains: [`chef-dishes-menus.orchestrate.md`](chef-dishes-menus.orchestrate.md). Each
milestone passed build, lint, jest (only the known TTL test fails) and the OpenAPI
check (104 operations), then its reviewers; CRITICAL/HIGH findings were fixed
before its commit.

| M | Commit | Migration (none applied) |
|---|---|---|
| 1 owners | `2308499` | `20260924120000_meal_ownership` |
| 2 chef dishes | `83f797d` | `20260924130000_chef_dishes` |
| 3 menus, showcase | `a79fe83` | `20260924140000_chef_menus` |
| 4 suggestions, offers | `ed89543` | `20260924150000_suggestions_offers` |
| 5 public page | `d9fd0d2` | — |
| 6 moderation | `8e1316e` | `20260924160000_moderation` |
| 7 photos (R2) | `34789d0` | — |
| 8 recipe versions, documents | `32ec358` | `20260924170000_recipe_versions` |
| docs | `4b21fcc` | — |

**User actions before it works end to end:** apply the six migrations (after #37's
and #40's), plus `20260924180000_user_deleted_at`; create the Brevo templates `BREVO_TPL_SOURCE_CHANGED` and
`BREVO_TPL_CONTENT_SUSPENDED`; create the R2 bucket and set `R2_*` (public domain,
CORS for `PUT` with `Content-Type`, `nosniff`); the frontend moves to the English
ids served by `/referentials/{allergens,diets,dish-categories}`.

**Known limits, deliberately left (see `ponytail:` comments):**
- `GET /menus/week` filters and orders all listed chefs in memory; the moderation
  queue merges and pages in memory.
- `sessionFromCents` is the cheapest service offer without commission (commission
  lives on the payments branch); `avatarUrl`, `rating`, `reviewCount`,
  `languages` are empty.
- A booking pins its recipe versions on first use: booking creation (501 today)
  should call `ShoppingListsService.pinRecipes`.
- Adoption and offers are not mapped to the review queue for menus' own content
  beyond publication and edits; a deleted dish leaves its R2 photo behind.
- A deleted Clerk account its bookings still reference is anonymised, not deleted
  (`UsersService.deleteByClerkId`). Bookings keep `address_line` and `notes` (GDPR
  art. 17(3)(b), legal retention): services-à-la-personne billing (the tax
  certificate, URSSAF avance immédiate) needs the client's identity and address for
  years. No invoicing module yet, so nothing breaks today. When one arrives, copy
  the client's name onto the booking rather than read it from `users`.
- An anonymised chef's candidature (name, email, phone, address) and identity
  documents stay as they are: FLOW-01 §8 keeps the documents until the end of the
  contract plus 5 years, and no end of contract is modelled. Upgrade: take
  `deleted_at` as that end and let the dossier job purge them after it.
- Only an anonymised account resists a late Clerk `user.updated`. A hard-deleted
  one leaves no row, so the event re-creates it with the personal data. Upgrade:
  anonymise every deleted account instead of deleting it; the row is then the
  tombstone.

**Clerk `user.deleted`:** `f0fcba5` (pushed) stopped the retries on a deletion
blocked by bookings (P2003). `7fb48a4` (pushed) replaces that blocked
handling with anonymisation: the users row gets `deleted-<id>@deleted.invalid`, no
name or phone, and `deleted_at`; the client profile goes; the chef profile becomes
"Compte supprimé", offline and unverified. Audited as `user.anonymised`. A late
`user.updated` leaves an anonymised row alone. Migration
`20260924180000_user_deleted_at`, not applied.

## Known issues, not caused by this work

- `npm run lint` fails after any fresh build: 27 errors, all in
  `src/generated/prisma/**`. `.eslintrc.js` does not ignore it. Pre-existing on
  develop. A separate task was spawned; do not fold into #37.
- `UsersService › registerClient` test fails on a sign-in TTL mismatch. The user
  says it is fixed on another branch — ignore it.

## Verification gate

From `apps/`, with `SUPABASE_DB_URL` and `SUPABASE_DB_MIGRATION_URL` set to any
postgres URL (prisma config requires them, nothing connects):
`npm run build`, `npx jest`, and `npm run lint` checked by **exit code** — a
`| tail` once hid a failure. Expect only the two known issues above.
