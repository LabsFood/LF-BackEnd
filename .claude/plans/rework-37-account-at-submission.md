# Rework #37 — the account exists from candidature submission

> Gate 1 plan, 21/09/2026. Branch `feat/batchcooker-chef-onboarding` (PR #37).
> Tier: medium — ~15 files, one migration, security trigger (public account creation).

## Findings that change the handoff

1. **The migration is applied on DEV.** `20260920120000_chef_onboarding` finished on
   Supabase `DEV_LF_Backend` at 13:14 UTC today. Editing it in place would break
   Prisma's checksum, so the rework adds `20260921120000_chef_account_at_submission`.
   DEV holds 0 candidatures and 0 documents (read-only check), so tightening columns
   is safe. I write it; I do not apply it.
2. **The sign-in link moves, it does not disappear.** The option you chose reads
   "creates the Clerk account itself, then emails a sign-in link". The link now goes
   out at submission instead of approval. It is sent **only to the inbox, never in the
   HTTP response** — that is the email-ownership proof: Clerk's Backend API marks the
   address verified, and with no password on the account the inbox is the only way in.
3. **New hole the rework would open.** Once every candidate holds a chef profile,
   `PATCH /admin/chefs/:id/verification {isVerified: true}` would verify a candidate
   with no document check. Closed in this rework.
4. **Reapply would regress.** Today a refused candidate reapplies by submitting again.
   With an account, public submission refuses their email, so a signed-in reapply path
   is needed or every refusal becomes permanent despite the reapply date.

## Flow after the rework

| Step | Who | What |
|---|---|---|
| Submit | public | `POST /chef-applications` (throttled 5/h/IP) → validate → email must be unused → Clerk user, **no password** → one transaction: `users` (role `chef`), chef profile (`isVerified:false`, `isActive:false`), candidature → email with a 7-day sign-in link → `201 {id, reference, status}` |
| First visit | candidate | Clicks the link → signed in → `GET /me` says chef, unverified → browse-only dashboard; `hasPassword:false` → choose-a-password screen (exists) |
| Documents | candidate | Existing `/me/chef-documents` routes; documents belong to the chef profile from the first upload |
| Status | candidate | New `GET /me/chef-application`: reference, status, refusal reason and reapply date |
| Approve | admin | Sets `isVerified:true`, `isActive` per body, copies the answers onto the profile — one transaction, no Clerk call. Emails "approved" |
| Reject | admin | Account stays, unverified. Reason and date stored and emailed |
| Reapply | candidate | New `POST /me/chef-application/reapply` after the date: reopens the same candidature with fresh answers |

## Browse-only, enforced on the backend

- `PATCH /me/chef-profile` → `403 CHEF_NOT_VERIFIED` until verified.
- `PATCH /admin/chefs/:id/verification` → `409` for `isVerified:true` on a profile whose
  candidature is not approved, and for `isActive:true` on an unverified profile.
- `PATCH /me/profile` (client onboarding) is already refused for any chef profile.
- **Not covered:** `POST /bookings`, `POST /quotes`, `POST /me/quotes/:id/accept`. Any
  chef account can call them today, verified or not. That is the self-dealing guard
  that belongs with the switcher decision. Say if unverified chefs should be blocked
  there now — it is one check in three services.

## Deleted

- `services/application-token.ts` (+ spec), `application-token.guard.ts`,
  `current-application.decorator.ts`.
- `GET /chef-applications/:id`, `POST …/documents/:type/upload-url`, `…/confirm`,
  `POST …/resend-link`.
- Approval's Clerk creation, the compensating delete (moves to submission, where the
  Clerk call now happens), the duplicate-email check, and the magic link.
- The `application` variant of `DocumentOwner` and the `applications/` storage prefix.
- New migration drops `token_hash`, `token_expires_at`, `resend_count`,
  `resend_window_started_at`, `approved_user_id`, `chef_documents.application_id`
  (with its unique index, FK and owner CHECK) and `uq_chef_applications_email_pending`
  (`users.email` is unique now). `chef_documents.chef_profile_id` becomes NOT NULL and
  unique with `(type, version)`.
- Kept nullable on purpose: `chef_applications.chef_profile_id` (`ON DELETE SET NULL`).
  The candidature row must outlive a deleted account as the 5-year consent proof.

## Kept, changed

- `POST /admin/chef-users/:id/resend-invitation` stays as the support path: re-sends the
  sign-in link to any chef-profile account whose link expired before first use.
- Brevo templates: `applicationReceived` gains the sign-in link;
  `BREVO_TPL_WELCOME_MAGIC_LINK` → `BREVO_TPL_SIGN_IN_LINK` (resend only); new
  `BREVO_TPL_APPLICATION_APPROVED`. None are provisioned yet, so renaming is free.
- Daily job: expiry warnings stay limited to verified chefs; the retention purge
  targets the documents of unverified profiles whose candidature was refused 3 months
  ago or idle 6 months. The account and the candidature row stay.

## Security requirements → where each one holds

| Requirement | Enforced by |
|---|---|
| An existing email never gains a chef profile unauthenticated | `users.email` lookup before Clerk, Clerk's own duplicate refusal after, both → `409 EMAIL_ALREADY_USED` |
| No account enumeration beyond existence | 409 body carries no role, name or status. Existence is already public through Clerk sign-up, so a 202-always response here would hide nothing |
| Email proven before the account can act | No password + link only in the inbox |
| Throttled | Existing `register` throttler, 5/h/IP |
| No privileged field in the body | DTO has none; global `forbidNonWhitelisted` |
| No orphan Clerk account | Transaction failure deletes the Clerk user (moved from approval) |
| Verification only through approval | Admin verification endpoint refuses the bypass (finding 3) |

A `security-review` pass runs after implementation, before Gate 2.

## Switcher — ponytail debt, not applied

`ponytail:` comment on `assertNoConflictingProfile` (done) and a todo in HANDOFF.md.

## Tasks (test first)

1. Migration + schema.
2. Documents owned by the chef profile: documents service, admin service, cron.
3. Submission creates the account: happy path, existing email, Clerk duplicate,
   transaction failure compensates, link never in the response.
4. `GET /me/chef-application` and reapply.
5. Approval and rejection simplified.
6. Browse-only: self-edit and admin verification.
7. Mailer, templates, config.
8. Delete the token machinery.
9. Docs: PRD constraints, AGENTS.md, `railway.md`, `.env.example`, PR #37 body. The
   FLOW-01 doc lives in `batchcooking-web/docs/api` (other repo): edited there,
   left uncommitted for you.
10. `security-review`, code review, verification gate.

Nothing is committed or pushed until you say so.
