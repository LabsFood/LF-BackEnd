# One account, two spaces — client ↔ chef switcher

> Feasibility analysis for FLOW-01 §10.2 ("un client existant candidate : fusionner
> ou refuser ?"). Decision pending. Written 21/09/2026 from a read of the code on
> `feat/batchcooker-chef-onboarding` (PR #37) and `batchcooking-web`.

## Verdict

**Feasible, and cheap on the backend — provided a self-dealing guard ships with it.**

The data model and the authorisation are already profile-based rather than
role-based. What blocks a dual account today is one guard function and the
frontend routing on a single `role`.

## What the code says

| Question | Finding | Where |
|---|---|---|
| Can one user hold both profiles? | **Yes, already.** `User.chefProfile?` and `User.clientProfile?` are both optional 1:1 relations. No migration needed. | `prisma/schema.prisma` |
| Does `users.role` authorise anything besides admin? | **No.** It is read for access control only by `AdminGuard`, checking `admin`. `client` / `chef` authorise nothing — they are a routing hint. | `auth/admin.guard.ts` |
| How are chef and client resources protected? | By ownership, not role: chef documents resolve the caller's `chefProfile`; bookings filter `clientId = caller`. | `chef-documents.controller.ts`, `bookings.service.ts` |
| What actually prevents holding both? | One guard, `assertNoConflictingProfile`, citing "reconciliation of orphaned profile, bookings, payouts". | `users.service.ts` |
| Where does the frontend get the role? | From `GET /me`, not Clerk metadata. `/apres-connexion` routes `role === 'chef'` → `/espace-chef`, else `/espace-client`. | `batchcooking-web/lib/auth-context.tsx`, `app/apres-connexion/page.tsx` |
| Can a user book their own chef profile today? | **Nothing prevents it.** Booking creation checks the client, never that client ≠ chef. | `bookings.service.ts` |

## What would change

**Backend — small, no migration**

- `GET /me` returns `clientProfile` and `chefProfile` independently of `role`,
  plus `spaces: ["client", "chef"]` derived from which profiles exist.
- `users.role` keeps its meaning for `admin`. For everyone else it becomes the
  default landing space and authorises nothing — which is already true in practice.
- Remove `assertNoConflictingProfile`.
- **Self-dealing guard:** a user may not book, quote, review or be paid for their
  own chef profile. One check where bookings and quotes are created.
- An existing client applying gains a chef profile on the same account.

**Frontend (`batchcooking-web`) — moderate**

- `auth-context` exposes `spaces` and the active space.
- `/apres-connexion` lands on the last-used space when both exist.
- A switcher in the dashboard header, rendered only when `spaces.length > 1`.
- The active space is per-device UI state. Persisting it server-side is not needed yet.

## How it fits the decisions already taken

- **Browse-only candidate** — the chef space shows in limited mode while the
  client space stays fully usable. The switcher makes the limited mode coherent
  instead of trapping the person in it.
- **Refused candidature stays** — the chef space keeps showing the refusal and
  the reapply date; the client space is untouched.
- **§10.2 dissolves** — "merge or refuse" becomes "merge", with the security
  condition below.

## Risks

| Risk | Severity | Mitigation |
|---|---|---|
| **Self-dealing** — a person books and pays themselves as their own chef | **High** — with URSSAF avance immédiate the client receives a 50 % tax credit on the amount paid, so booking yourself is a tax-credit fraud surface, not just a data oddity | Refuse any booking, quote or review where the chef profile's owner is the caller. Must ship **with** the switcher, not after |
| **Attaching a chef profile to someone else's account** | **High** — account takeover | `POST /chef-applications` is public (decided). If the submitted email already has an account, it must **not** attach to it: refuse and ask the person to sign in and apply from that account. Only a signed-in holder can add a chef profile to an existing account |
| Unclear context in emails and notifications | Low | Name the space in the subject where both exist |

The second risk applies to the public account-creation decision **whether or not
the switcher is adopted**: a public endpoint must never grant anything on an
existing account on the strength of an email address alone.

## Effort, relative

| Part | Size |
|---|---|
| Backend | Small — `GET /me` shape, remove one guard, self-dealing check, apply-from-existing-account path |
| Frontend | Moderate — context, landing logic, header switcher |
| Migration | None |

## The alternative, if deferred

Keep "refuse if the account has client activity". Zero switching code; a client
who wants to cook applies with a separate account and a second email. The
self-dealing guard is then less urgent — though it costs little and closes a hole
that exists today regardless.

## Decision needed

1. Adopt the switcher **in the #37 rework**, or **after FLOW-01 lands**?
2. Either way: ship the self-dealing guard now? It closes a hole that exists today.
