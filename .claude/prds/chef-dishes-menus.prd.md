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
- `meals.ingredients` is not structured in practice. `POST`/`PATCH /admin/meals`
  accept only a JSON object and refuse a list with 400, while shopping lists read
  only a list of `{ name, qty, unit, aisle }`. Ingredients saved through the API
  today never reach a shopping list.
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
| **Ownership and authorship are separate columns** — `chef_profile_id` (owner) and `created_by_user_id` (author) | Conflating them would make whoever typed a row its owner. An admin creating or editing a Lab's Food meal or menu must not lock it to themselves: it stays unowned — public to every chef as a suggestion, or visible to one chef as an offer — and **any** admin may edit it until a chef owns it, not only its author. `created_by_user_id` is attribution only and never grants a permission — rights come from `chef_profile_id` and role. Who changed what afterwards is already in `audit_log`, so no `updated_by` column. |
| A **suggestion** is a meal or menu authored by Lab's Food, owned by no chef, and offered to no one in particular | Lab's Food content not prepared for a specific chef is offered to every chef as a suggestion (§6's "proposition"); applies to menus as well as meals, since FLOW-02 §1 calls a proposition a menu and §6 treats it as dishes. Unowned content offered to one chef is an **offer**, not a suggestion: only that chef sees it. Existing `meals` rows predate `created_by_user_id`, were all written by Lab's Food, and count as suggestions. |
| **A chef never reads or copies another chef's content** | Through the chef-facing API a chef reads and writes only their own menus and dishes, and can adopt only suggestions — never another chef's menu, meal or dish. §8 already withholds a recipe from every non-owner chef; this extends the rule to copying. The public vitrine is unaffected: its fields are public to everyone by definition, and it never carries a recipe. |
| **Every adoption is written to the audit log** | §6 requires the consent to be proven — who, when, which version. The audit log already built for FLOW-01 is that proof: each adoption records the chef, the suggestion, its version, the copy created and the explicit consent, and is retained five years like the rest of the log. A menu adoption records the menu and each dish it copied. |
| **A menu is composed of several dishes, and a dish may sit in several menus** | Menus and dishes are many-to-many: a dish is not owned by a menu, and a chef reuses the same dish across menus. This is also why adoption must reuse copies — adopting two suggested menus that share a dish gives the chef that dish once, in both. |
| **An offered menu's dishes follow their own kind** | An offered menu may contain dishes offered to the same chef and public suggestions. On acceptance the offered dishes transfer with the menu, while suggestion dishes are **adopted** (copied, reusing any existing copy) so they stay available to every other chef. A public suggestion menu may contain only public suggestion dishes — it must never expose a dish offered privately to one chef. |
| A chef takes ownership by **adopting**, which creates a copy | The copy is owned by the chef (`chef_profile_id`), authored by the chef (`created_by_user_id`), and points back to its source (`adopted_from_id`). The original stays unowned, so one chef adopting never takes it away from another. Adopting a Lab's Food **menu** also copies each of its dishes. The reason is §6 with §8, not §3.4: a proposition is previewed with "ni ingrédients ni étapes", and a non-owner chef has no access to a recipe — so without adoption a chef could not cook the dish, nor produce its fiche or shopping list. Adoption is what hands the recipe over. |
| **An admin may prepare content for one chef; it becomes theirs only when they accept** | Lets Lab's Food build a menu for a batch cooker who has none yet, without imposing it (§6). The admin marks a meal or menu as **offered** to that chef: it stays unowned, is visible only to that chef and to admins, and never appears as a public suggestion. **Accepting transfers ownership of the row itself** — no copy, because no other chef needs the original — and writes the same audit-log consent record as an adoption. `created_by_user_id` keeps the admin as author while `chef_profile_id` makes the chef the owner, which is the case the two columns exist for. Declining leaves it with Lab's Food, free to re-offer or publish as a suggestion. |
| **Ownership only ever changes through the chef's own act** | No admin write path sets `chef_profile_id`: an admin creates unowned content and may mark whom it is offered to, but ownership moves only when a chef creates, adopts or accepts. Moderation changes status and reason only. This is what keeps §6's "rien n'est imposé" true while letting admins prepare content for a specific chef. |
| **Adoption is idempotent per (chef, source)** | A double-click, or two Lab's Food menus sharing a dish, would otherwise duplicate rows. Re-adopting returns the chef's existing copy; a dish shared between adopted menus is copied once, and the chef's edited version is the one reused. |
| **Publishing a menu publishes its draft dishes with it** | Removes the friction of adoption — a 7-dish menu would otherwise need eight separate publications. §3.4 already forbids a published menu containing a draft dish, so publishing the menu already means making its dishes public. All-or-nothing, each dish still passes every §3.3 check, and the error lists each dish that failed. Lifts `draft` only: a `suspended` dish is never republished this way, or it would bypass a moderation decision. |
| **A safety-relevant edit to a proposition flags every copy made from it** | The flip side of copying: copies are insulated from bad edits but also from corrections. An edit to allergens, diets or country — the fields §3.2 already treats as review-worthy — flags each adopted copy `source-changed`, notifies its chef, and places it in the admin review queue. Not applied to the copy automatically (§6), and not auto-suspended: FLOW-01 §7 keeps expiry the only unattended takedown. If the edit added a regulated allergen, the admin suspends affected copies through the existing §4.3 moderation. |
| Legacy `/admin/meals` writes are **scoped to Lab's Food rows** | Otherwise an admin could overwrite a chef's dish through the old endpoint with no reason and no audit — the sharpest double-truth risk in the merge. |
| `suspended` is valid **only** for chef-owned rows, enforced by a CHECK | Keeps `archived` (Lab's Food retired it) and `suspended` (a chef was moderated) from blurring into one column. |
| Publication is **direct**, moderation is **after the fact** | Decided 20/09/2026. It makes the automatic checks the only barrier before a dish is public, so those checks are blocking (§3.3). |
| **Explicit allergen declaration** — `allergens` non-empty **or** `allergensNone: true` | An empty array cannot distinguish "no allergens" from "not filled in". Without this, direct publication puts dishes online with no allergen information. |
| Vitrine order: **rotation above a relevance floor, seeded monthly** | Filter to chefs who cover the area and are not fully booked — a chef with no slots configured still appears, as available on request — then rotate exposure with one order per calendar month, identical for every visitor. §9.6 notes this decides who receives demand; rating-first would entrench whoever arrived first. Monthly matches the "Vitrine du mois" cadence (§3.5) and keeps the order explainable and pagination stable. |
| A chef with **no menu for the week is shown last, and marked** | Settles §9.7. They stay bookable with their published dishes — an oversight should not make an available chef invisible — but sort below chefs who composed a menu, and carry a flag so the frontend can present them differently. Rotation applies within each group. |
| Dish photos on **Cloudflare R2**, presigned, moderated with the dish | Public storefront images are the high-egress case, unlike KYC documents. R2 has no egress fee; it speaks S3, so the presigned flow mirrors the KYC one — including its upload controls: a closed list of image types, a size cap, and every object stored under the owning chef, so the upload path cannot be used to host arbitrary files. |
| Batch cooker **profile photos** on the same R2 bucket, settable **before approval** (decided 03/10/2026) | Same flow and controls as dish photos, under `chefs/{id}/avatar/`. A candidate may add theirs, the one exception to browse-only: dishes and menus still wait for approval. The photo shows publicly only once the chef is listed, and an admin takedown (`DELETE /admin/chefs/:id/photo`) is audited. |
| Shopping lists are **computed deterministically** | `recipe.ingredients` is **a list of `{ name, qty, unit, aisle }`, validated as such on every write path**: the chef's routes and the legacy `/admin/meals` ones, which today accept only an object and refuse a list (see Evidence). With that guaranteed, scaling, deduplication by (name, unit) and grouping by aisle is arithmetic, not inference. Free-text dishes with no recipe contribute nothing automatically; the chef adds those lines by hand, as corrections that survive recalculation. |
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
- Admin review queue covering never-reviewed, edited-after-review,
  republished-after-suspension and source-changed content, one-click "reviewed", and removal with a
  mandatory 15–500 character reason shown verbatim to the chef.
- Public `GET /menus/week` with area, diet, shopping and free-text filters,
  `coveredDiets` computed as the intersection across the whole menu, ordering
  that shares exposure month by month, and chefs with no menu that week listed
  last and marked.
- Public chef vitrine, with badges derived from the validated KYC documents.
- Lab's Food suggestions — meals **and** menus authored by Lab's Food and owned
  by no chef — visible to every chef. Adoption copies the suggestion into the
  chef's own space as a draft, with lineage, and is written to the audit log as
  the consent proof §6 requires. Adopting a menu also copies its dishes, reusing
  any the chef already adopted. Adoption is idempotent per chef and source.
- Offers: an admin prepares a meal or menu for one specific chef; it is visible
  only to them, and becomes theirs only when they accept — transferring the row,
  with the same audit-log consent record as an adoption. Declining leaves it
  with Lab's Food.
- Chef isolation: a chef reads, writes and adopts only their own content,
  public suggestions and offers made to them — never another chef's menu, meal
  or dish, nor an offer prepared for someone else.
- Menus composed of several dishes, with a dish reusable across menus.
- Publishing a menu publishes its draft dishes in the same all-or-nothing action.
- A safety-relevant edit to a proposition flags every copy made from it for the
  chef and for admin review.
- Separate ownership (`chef_profile_id`) from authorship (`created_by_user_id`)
  on meals and menus, so an admin editing Lab's Food content never becomes its
  owner and any admin may maintain it.
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
| 1 | Dishes have owners | `meals` becomes the chef-owned dish without breaking bookings, quotes, shopping lists or stats. Ownership and authorship are separate, so admin-authored Lab's Food rows stay unowned and public to every chef, any admin can maintain them, and legacy admin writes can no longer touch a chef's dish. | complete | `2308499` |
| 2 | A chef can publish a dish | Create, edit, publish and unpublish, with the blocking checks — no dish goes public without an explicit allergen declaration or from an unverified chef. Free-text diets and allergens are accepted alongside the reference lists. Ingredients are saved as the structured list shopping lists read, on chef and legacy admin writes alike. | complete | `83f797d` |
| 3 | A chef can publish a week | Menus hold several dishes, a dish reusable across menus, with the same owner and author split as dishes, and declare whether shopping is included. Publishing a menu publishes its draft dishes, all or nothing. The vitrine assigns one menu per week; a suspended dish drops out of its menus without taking them down. | complete | `a79fe83` |
| 4 | A chef can start from Lab's Food | Lab's Food authors suggested dishes and menus that every chef can preview, recipe excluded, and adopt as a draft copy of their own: idempotent, with lineage, and an audit-log row as the consent proof. An admin can instead offer a dish or menu to one chef, who alone sees it and makes it theirs by accepting, or leaves it with Lab's Food by declining. A safety-relevant edit to a suggestion flags every copy `source-changed` and notifies its chef. | complete | `ed89543` |
| 5 | The public page lists cooks, not dishes | `GET /menus/week` serves the week's cards filtered by area, diet and shopping, ordered by a monthly rotation above a relevance floor, chefs without a menu last and marked, and no recipe ever included. Each chef's public page shows their published dishes and menus, with badges derived from their validated KYC documents. `GET /menus/current` deprecated. | complete | `d9fd0d2` |
| 6 | Admins can moderate after the fact | A review queue that surfaces never-reviewed, edited, republished and `source-changed` content, one-click review, and removal with a reason the chef reads verbatim. Recurring free-text diets and allergens are surfaced so they can join the reference list. | complete | `8e1316e` |
| 7 | Dishes have photographs | Presigned upload to R2, moderated with the dish. | complete | `34789d0` |
| 8 | A prestation leaves its documents | Fiche recette scaled to portions and pinned to the recipe version cooked, flagged when the chef has since changed it; shopping list aggregated and corrigible, with corrections surviving recalculation; the culinary map colouring in. | complete | `32ec358` |

Milestones 1–5 are the testable hypothesis. 4 belongs there because the hypothesis
rests on chefs filling a weekly vitrine, and starting from a Lab's Food menu or an
offer is the fastest way to fill one. 6 is the safety net that direct publication
depends on. 7 and 8 are what make the vitrine sell and the prestation complete.

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
| Who owns Lab's Food meals and menus? | **Nobody.** `chef_profile_id` (owner) is separate from `created_by_user_id` (author). The admin who creates or edits Lab's Food content does not own it, and any admin may edit it. A chef gains ownership only of their own adopted copy, or of an offer made to them that they accept. |
| Adopting a menu means eight publications | **Publishing the menu publishes its draft dishes**, all-or-nothing. Never lifts `suspended`. |
| Double adoption, and dishes shared between menus | **Adoption is idempotent per (chef, source).** |
| A correction to a proposition never reaches its copies | **Flag, notify, review** — every copy is marked `source-changed`. No automatic change, no automatic suspension. |
| What makes content a suggestion? | **Authored by Lab's Food, owned by no chef, offered to no one in particular.** Legacy `meals` rows count. |
| Can a chef see or copy another chef's content? | **No.** Only their own content and suggestions, through the chef API. |
| Is adoption audited? | **Yes** — every adoption is an audit-log row, and that row is §6's consent proof. |
| Menu and dish cardinality | **Many-to-many.** A menu holds several dishes; a dish may appear in several menus. |
| Can an admin give content to a specific chef? | **Yes, as an offer the chef must accept.** Accepting transfers the row (no copy); declining leaves it with Lab's Food. The admin never sets ownership directly. |
| When does a prestation pin its recipe version? | **At booking.** The shopping list (made before the prestation) and the fiche (handed over after it) therefore always come from the same version. The chef may **re-pin** before the prestation — a deliberate, audited act that regenerates the shopping list. |
| What does the "recipe updated" flag carry? | A flag, plus the **pinned** and **current** version numbers so it is actionable. No diff. |
| `shoppingIncluded` when a menu is duplicated | Moot: FLOW-02 has no duplicate-menu endpoint. `false` at creation, editable after. |
| What counts as "has free slots"? | **Exclude only the fully booked.** A chef with no slots configured still appears, shown as available on request; a chef whose configured slots are all taken drops out. |

## Open Questions

None blocking planning. Everything raised by FLOW-02 §9 and by the decisions
above is settled in the table.

## Risks

Only risks that remain after the constraints above. Anything a constraint already
eliminates, and every trade-off accepted in **Decisions taken**, is recorded there
rather than repeated here.

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| **Wrong allergen information reaches a client** — a chef publishes an incomplete declaration, or Lab's Food corrects a suggestion and the copies chefs already adopted keep the old one | Medium | **Severe** — food safety and legal exposure | Explicit declaration of the 14 regulated allergens is a blocking publication check. A safety edit to a suggestion flags every copy `source-changed`, notifies its chef and queues it for review; an added allergen lets the admin suspend copies through §4.3. Residual: the delay before a human acts on a corrected suggestion |
| **Direct publication puts inappropriate content on the public site** | Medium | High — it is the visible storefront | The blocking checks are the only barrier before publication, so they stay blocking; the review queue surfaces never-reviewed content oldest first; removal is immediate and reasoned |
| **One access path is wrong** — a recipe leaks to the public or to another chef, an offer reaches the wrong chef, or an admin overwrites a chef's dish through the legacy endpoint | Medium | High — a chef's recipe is their craft, and a silent overwrite loses their work | One ownership rule enforced on every read and write path; legacy `/admin/meals` writes limited to content no chef owns; §8's access table plus offers encoded as a single table-driven test across every actor |
| **Extending `meals` silently changes what existing features do** — stats and admin lists start counting chef dishes the day the column appears | **High** | Medium | Audit all five modules that read `meals` and add an explicit owner filter to each, as milestone 1 work rather than cleanup |
| **Vitrine ordering decides who earns** — rotation still entrenches whoever sits above the floor, and a monthly seed holds a chef in last place for a whole month | Medium | High — it shapes income and is hard to unwind | Rotation above a relevance floor rather than rating-first, written as an explicit reviewable rule; revisit the seed period if coverage data shows exposure concentrating |
| **The vitrine fills with identical adopted menus** — many chefs adopt the same suggestion, undercutting "choose a cook, not a dish" | Medium | Medium | Every copy records its origin, so the public card can say it is a Lab's Food classic; how to present it is a frontend decision |

---
*Status: implemented on `feat/chef-dishes-menus`, one commit per milestone (see the table). Migrations not applied yet.*
