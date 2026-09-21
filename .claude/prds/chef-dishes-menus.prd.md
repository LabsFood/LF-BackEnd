# Plats, menus, publication et modération

> Source of truth for behaviour: [`FLOW-02-plats-et-menus.md`](../../../FLOW-02-plats-et-menus.md).
> Depends on the `isVerified` gate shipped by
> [`batchcooker-chef-onboarding.prd.md`](batchcooker-chef-onboarding.prd.md) (FLOW-01).
> This PRD states *what must be true*; `/plan` decides *how*.

## Problem

Lab's Food sells batch cooking, and the page that sells it — `/menu` — lists an
anonymous catalogue of dishes nobody cooks. The dishes in `meals` are written by
the Lab's Food team, belong to no one, and a client browsing them cannot tell
which batch cooker would actually turn up in their kitchen.

Meanwhile a batch cooker has no way to put their own cooking online. There is no
endpoint for a chef to create a dish, compose a week's menu, or publish anything.
The vitrine an approved chef is promised at the end of onboarding does not exist,
so the account FLOW-01 creates currently leads nowhere.

Two consequences follow. Clients choose a meal instead of choosing a cook, which
is the opposite of the product. And nothing produces the two documents a
prestation is supposed to leave behind — the fiche recette and the liste de
courses — because no recipe is attached to anyone's actual service.

## Evidence

Qualitative, as for FLOW-01. No catalogue instrumentation exists yet.

- `GET /menus/current` serves one global weekly menu for the whole platform.
  There is no per-chef concept anywhere in the catalogue, so the "carte de la
  semaine, chef par chef" the site is meant to show cannot be assembled.
- `meals` carries `ingredients` and `steps` but no owner, so the recipe that
  would produce a fiche recette belongs to nobody and is reachable by anyone.
- FLOW-01 ships accounts for verified batch cookers whose storefront has no
  content behind it. The `CHEF_NOT_VERIFIED` publication gate specified in
  FLOW-02 §3.3 has no publication to gate.
- FLOW-02 was written and decided on 20/09/2026 with error codes, moderation
  reason codes and access rules specified end to end.

**Assumption needing validation**: that chefs will publish enough to fill a weekly
vitrine without editorial help. The Lab's Food propositions (§6) exist partly as
insurance against this, and the adoption rate is the metric that tests it.

## Users

- **Primary — the approved batch cooker.** Verified, with a dossier in good
  standing. Writes dishes and their recipes, composes menus, assigns a menu to
  each week of the month, and publishes. Their income depends on being visible in
  the right week and the right area.
- **Primary — the visitor choosing a batch cooker.** Arrives on `/menu`
  unauthenticated, filters by area, diet and whether shopping is included, and
  picks a person, not a dish.
- **Secondary — the Lab's Food admin.** Works a review queue *after* publication,
  marks content reviewed in one click, and removes content with a written reason.
  Also curates the propositions catalogue.
- **Secondary — the client during and after a prestation.** Receives the fiche
  recette and the liste de courses, and sees delivered countries colour in on
  their culinary map.
- **Not for**: unverified chefs, who cannot publish at all; and visitors, who
  never see ingredients or steps.

## Hypothesis

We believe **letting a verified batch cooker publish their own dishes and weekly
menus directly, with moderation after the fact**, will **turn `/menu` from an
anonymous catalogue into a weekly choice between named cooks, and produce the
recipe documents a prestation owes the client**, for **verified batch cookers and
the visitors choosing between them**.

We'll know we're right when **most active verified chefs have a published menu for
the current week, and moderation stays rare enough that publishing directly was
the right trade.**

## Success Metrics

| Metric | Target | How measured |
|---|---|---|
| **Weekly vitrine coverage** (primary) | ≥ 70% of `isActive` chefs have a published menu for the current week | Count over `chef_showcase_weeks` for the live week |
| **Moderation rate** (guardrail) | ≤ 5% of published dishes are ever `suspended` | Suspensions ÷ dishes ever published |
| **Undeclared allergens** (guardrail) | **0** published dishes with neither `allergens` nor `allergensNone` | Invariant; publication is refused rather than counted |
| **Time to first review** | ≥ 90% of newly published content reviewed within 72 h | `publishedAt` → first `POST /admin/dishes/:id/review` |
| **Proposition adoption** | baseline only, no target | `adopt` calls ÷ propositions offered — tests the editorial-help assumption |
| **Recipe completeness** | baseline only | Share of published dishes with `recipeComplete = true` |

The first two targets are estimates with no baseline. They exist to be calibrated
against the first month of real publishing.

## Constraints already decided

| Decision | Rationale |
|---|---|
| **Extend `meals` into the chef-owned dish** rather than add a second table | `meals` already carries ~80% of the fields, and `booking_meals` references it. §4.3 requires a suspended dish to stay resolvable for prestations already booked — with one table that is automatic; with two, a booking would have to reference either table. |
| `chef_profile_id IS NULL` **is** the Lab's Food catalogue | It is also exactly §6's "proposition". One concept, not two. |
| Legacy `/admin/meals` writes are **scoped to Lab's Food rows** | Otherwise an admin could overwrite a chef's dish through the old endpoint with no reason and no audit — the sharpest double-truth risk in the merge. |
| `suspended` is valid **only** for chef-owned rows, enforced by a CHECK | Keeps `archived` (Lab's Food retired it) and `suspended` (a chef was moderated) from blurring into one column. |
| Publication is **direct**, moderation is **after the fact** | Decided 20/09/2026. It makes the automatic checks the only barrier before a dish is public, so those checks are blocking (§3.3). |
| **Explicit allergen declaration** — `allergens` non-empty **or** `allergensNone: true` | An empty array cannot distinguish "no allergens" from "not filled in". Without this, direct publication puts dishes online with no allergen information. |
| Vitrine order: **rotation above a relevance floor, seeded monthly** | Filter to chefs who cover the area and are not fully booked — a chef with no slots configured still appears, as available on request — then rotate exposure with one order per calendar month, identical for every visitor. §9.6 notes this decides who receives demand; rating-first would entrench whoever arrived first. Monthly matches the "Vitrine du mois" cadence (§3.5) and keeps the order explainable and pagination stable. |
| A chef with **no menu for the week is shown last, and marked** | Settles §9.7. They stay bookable with their published dishes — an oversight should not make an available chef invisible — but sort below chefs who composed a menu, and carry a flag so the frontend can present them differently. Rotation applies within each group. |
| Dish photos on **Cloudflare R2**, presigned, moderated with the dish | Public storefront images are the high-egress case, unlike KYC documents. R2 has no egress fee; it speaks S3, so the presigned flow mirrors the KYC one. |
| Shopping lists are **computed deterministically** | `recipe.ingredients` is already structured, so scaling, deduplication by (name, unit) and grouping by aisle is arithmetic, not inference. Free-text dishes with no recipe contribute nothing automatically; the chef adds those lines by hand, as corrections that survive recalculation. |
| `shoppingIncluded` is a **per-menu flag, `false` on creation** | Settles where the public filter's data lives: nothing in the schema expressed it. Per menu lets a chef offer shopping on some weeks and not others; defaulting to `false` means a chef never advertises a service they did not choose to offer. |
| **Recipes are versioned; a prestation pins the version it was cooked from** | Settles §9.2. The fiche a client received and the one the API serves always agree, and a dispute about what was cooked is answerable. When the chef has since edited the recipe, the fiche says so with a flag rather than silently showing the new one. |
| **Free-text allergens never satisfy the publication gate** | The chef must still answer, explicitly, whether the dish contains any of the 14 regulated allergens, and may add free-text ones on top. A custom value such as "sarrasin" alongside an unanswered regulated list is refused — otherwise a dish could go public having declared buckwheat and never said whether it contains milk. |
| `GET /menus/current` is **deprecated, not removed** | No consumer exists in either frontend, and FLOW-02's `GET /menus/week` supersedes it. Deprecated in Swagger with every call logged, so any consumer outside these two repos surfaces in Railway before anything breaks. Removed in a follow-up once the logs are silent. |
| Recipes are **never** exposed publicly | §8: ingredients and steps are the chef's craft, handed to the client after the prestation and to admins for review — never on the vitrine. |

## Scope

**MVP** — the whole of FLOW-02:

- Chef-owned dishes with recipes: create, edit, publish, unpublish, with the
  blocking publication checks of §3.3 including the explicit allergen declaration
  and the `CHEF_NOT_VERIFIED` gate.
- Free-text `customDiets` / `customAllergens`, surfaced to admins as flags so a
  recurring value can graduate into the official reference list.
- Menus: compose from published dishes, publish, and the rule that a menu may not
  expose a draft or suspended dish. Each menu carries its own `shoppingIncluded`.
- Vitrine du mois: assign a menu to each week, `null` meaning "no menu this week".
- Admin review queue covering never-reviewed, edited-after-review and
  republished-after-suspension content, one-click "reviewed", and removal with a
  mandatory 15–500 character reason shown verbatim to the chef.
- Public `GET /menus/week` with area, diet, shopping and free-text filters,
  `coveredDiets` computed as the intersection across the whole menu, ordering
  that shares exposure month by month, and chefs with no menu that week listed
  last and marked.
- Public chef vitrine, with badges derived from the validated KYC documents.
- Lab's Food propositions: list, and adopt with recorded consent and lineage.
- Dish photos: presigned upload, moderated alongside the dish.
- Recipe versioning: each edit to a recipe is a new version. A prestation pins
  the current version **at booking**, so its shopping list and its fiche always
  agree; the chef may explicitly re-pin before the prestation, which regenerates
  the shopping list. The fiche flags when a newer version exists, with both
  version numbers.
- Recipe documents: fiche recette scaled to the requested portions, and the
  per-prestation shopping list with chef corrections that survive recalculation,
  plus a reset.
- `shoppingIncluded` as a per-menu flag, `false` when a menu is first created.
- Deprecation of `GET /menus/current`, with calls logged.
- Client culinary map keyed by both ISO alpha-2 and numeric codes, counting only
  prestations actually delivered.

**Out of scope**

- **AI-generated shopping lists.** Decided out of scope on 21/09/2026. Lists are
  computed from structured recipes; anything outside the catalogue is added by
  the chef by hand.
- **Removing `GET /menus/current` and the `menu_weeks` model.** Deprecated in
  this work; removed only once the call logs show no remaining consumer.
- **Deduplicating dishes across chefs** (§9.4) — two chefs may both publish
  "Poulet rôti aux herbes". Acceptable for now.
- **Forcing prestations through the catalogue** (§9.3) — free-text dishes on a
  booking continue to be tolerated. They produce no fiche and contribute no
  shopping lines automatically.
- **A review SLA with staffing behind it** (§9.5) — the metric is measured, but
  no commitment is made about the queue being worked within a fixed time.
- **Frontend work** — the `/menu` page, the chef recipe screens and the admin
  tab live in their own repos.

## Delivery Milestones

| # | Milestone | Outcome | Status | Plan |
|---|---|---|---|---|
| 1 | Dishes have owners | `meals` becomes the chef-owned dish without breaking bookings, quotes, shopping lists or stats. Lab's Food rows keep working and legacy admin writes can no longer touch a chef's dish. | pending | — |
| 2 | A chef can publish a dish | Create, edit and publish with the blocking checks — no dish goes public without an explicit allergen declaration or from an unverified chef. | pending | — |
| 3 | A chef can publish a week | Menus compose published dishes and declare whether shopping is included; the vitrine assigns one menu per week; a suspended dish drops out of its menus without taking them down. | pending | — |
| 4 | The public page lists cooks, not dishes | `GET /menus/week` serves the week's cards filtered by area, diet and shopping, ordered by a monthly rotation above a relevance floor, chefs without a menu last and marked, and no recipe ever included. `GET /menus/current` deprecated. | pending | — |
| 5 | Admins can moderate after the fact | A review queue that surfaces never-reviewed, edited and republished content, one-click review, and removal with a reason the chef reads verbatim. | pending | — |
| 6 | Dishes have photographs | Presigned upload to R2, moderated with the dish. | pending | — |
| 7 | A prestation leaves its documents | Fiche recette scaled to portions and pinned to the recipe version cooked, flagged when the chef has since changed it; shopping list aggregated and corrigible, with corrections surviving recalculation; the culinary map colouring in. | pending | — |

Milestones 1–4 are the testable hypothesis. 5 is the safety net that direct
publication depends on. 6 and 7 are what make the vitrine sell and the prestation
complete.

## Decisions taken

Settled on 21/09/2026, before planning. Recorded here so `/plan` does not reopen them.

| Question | Decision |
|---|---|
| Does `GET /menus/current` retire? | Deprecated now, calls logged; removed once no consumer appears. No caller exists in either frontend. |
| A chef with nothing published for the week (§9.7) | Shown **last**, with their published dishes, and **marked**. |
| Is a delivered fiche recette frozen (§9.2)? | **Recipes are versioned**; the prestation pins the version cooked, and the fiche carries a flag when a newer version exists. |
| Where does `shoppingIncluded` come from? | A **per-menu** flag, `false` when the menu is first created. |
| What does the rotation rotate on? | **Monthly**, one order per calendar month, identical for every visitor. |
| Do free-text `customAllergens` satisfy the publication gate? | **No.** The 14 regulated allergens must always be answered explicitly. |
| AI-generated shopping lists | **Out of scope.** |
| When does a prestation pin its recipe version? | **At booking.** The shopping list (made before the prestation) and the fiche (handed over after it) therefore always come from the same version. The chef may **re-pin** before the prestation — a deliberate, audited act that regenerates the shopping list. |
| What does the "recipe updated" flag carry? | A flag, plus the **pinned** and **current** version numbers so it is actionable. No diff. |
| `shoppingIncluded` when a menu is duplicated | Moot: FLOW-02 has no duplicate-menu endpoint. `false` at creation, editable after. |
| What counts as "has free slots"? | **Exclude only the fully booked.** A chef with no slots configured still appears, shown as available on request; a chef whose configured slots are all taken drops out. |

## Open Questions

None blocking planning. Everything raised by FLOW-02 §9 and by the decisions
above is settled in the table.

## Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| A dish goes public with incomplete allergen information | Medium | **Severe** — this is a food-safety and legal exposure, not a UX defect | Explicit declaration is a blocking publication check; `no-allergens-declared` is a review flag; `allergens-incomplete` is a first-class moderation reason |
| Extending `meals` silently changes existing aggregates | **High** | Medium — stats and admin lists quietly start counting chef dishes | Audit all five dependent modules and add explicit owner filters; treat this as milestone 1 work, not cleanup |
| An admin overwrites a chef's dish through the legacy endpoint | Medium | High — silent loss of a chef's work, no reason, no audit | Legacy `/admin/meals` writes scoped to `chef_profile_id IS NULL`; chef rows writable only by owner or by moderation |
| Direct publication puts inappropriate content on the public site | Medium | High — it is the visible storefront | Blocking automatic checks are the barrier; the review queue is worked oldest-first; removal is immediate and reasoned |
| Vitrine ordering entrenches early chefs | Medium | High — decides who earns, and is hard to unwind later | Rotation above a relevance floor rather than rating-first; the ordering is an explicit, reviewable rule rather than an incidental `ORDER BY` |
| A chef drawn last stays last for a whole month | Medium | Medium — monthly rotation evens exposure out over a year, not over a week | Accepted trade-off for a stable, explainable order that matches the monthly vitrine cadence. Revisit the seed period if coverage data shows exposure concentrating |
| A chef forgets to compose a menu and is pushed to the bottom | Medium | Medium — lost bookings through an oversight rather than a choice | They remain bookable and marked rather than hidden; the chef can be reminded when a week with no menu approaches |
| Recipe versioning multiplies storage and query complexity | Medium | Low | Versions are append-only and small; only the version pinned by a prestation needs to stay reachable |
| A chef edits a recipe after booking and forgets to re-pin | Medium | Low — the client receives the recipe they booked, which is the safe failure | Pinning at booking makes the stale case the *consistent* one; the "recipe updated" flag tells the chef a newer version exists |
| Visitors click through to chefs who cannot actually be booked | Medium | Medium — a chef with no configured slots appears but has no bookable time | Deliberate trade to give new chefs exposure before they set up an agenda; shown as available on request so the page does not promise a slot |
| Recipes leak through the public endpoints | Low | High — it is the chef's craft and the reason they trust the platform | Recipe fields are excluded at the serialisation boundary for every public route, with a test asserting their absence |
| Photo upload becomes a path for arbitrary file hosting | Low | Medium | Same constraints as KYC — closed MIME list, size cap, and objects scoped under the owning chef |

---
*Status: DRAFT — requirements only. Implementation planning pending via /plan.*
