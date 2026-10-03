# Plan-Orchestrate Result

**Plan**: `.claude/prds/chef-dishes-menus.prd.md`
**Lang**: `typescript`
**ECC mode**: `plugin`
**Steps**: 8 (milestone 8 split into 8a and 8b)
**Scope**: all

## Steps overview

| # | Title | Tags | Chain |
|---|---|---|---|
| 1 | Dishes have owners | impl, db, security | `ecc:tdd-guide,ecc:database-reviewer,ecc:typescript-reviewer,ecc:security-reviewer` |
| 2 | A chef can publish a dish | impl, db, security | `ecc:tdd-guide,ecc:database-reviewer,ecc:typescript-reviewer,ecc:security-reviewer` |
| 3 | A chef can publish a week | impl, db, security | `ecc:tdd-guide,ecc:database-reviewer,ecc:typescript-reviewer,ecc:security-reviewer` |
| 4 | A chef can start from Lab's Food | impl, db, security | `ecc:tdd-guide,ecc:database-reviewer,ecc:typescript-reviewer,ecc:security-reviewer` |
| 5 | The public page lists cooks, not dishes | impl, security | `ecc:tdd-guide,ecc:typescript-reviewer,ecc:security-reviewer` |
| 6 | Admins can moderate after the fact | impl, db, security | `ecc:tdd-guide,ecc:database-reviewer,ecc:typescript-reviewer,ecc:security-reviewer` |
| 7 | Dishes have photographs | impl, security | `ecc:tdd-guide,ecc:typescript-reviewer,ecc:security-reviewer` |
| 8a | Recipe versions and the fiche recette | impl, db, security | `ecc:tdd-guide,ecc:database-reviewer,ecc:typescript-reviewer,ecc:security-reviewer` |
| 8b | Shopping list and culinary map | impl, db | `ecc:tdd-guide,ecc:database-reviewer,ecc:typescript-reviewer` |

Milestone 4 was added to the PRD to cover adoption, offers and `source-changed` flags, which no milestone owned. Milestones 2, 5 and 6 now name the free-text values and the public chef page.

---

## Step 1 — Dishes have owners

**Intent**: `meals` becomes the chef-owned dish with ownership (`chef_profile_id`) separate from authorship (`created_by_user_id`). Lab's Food rows stay unowned and admin-maintained, and legacy admin writes can no longer touch a chef's dish.
**Tags**: impl, db, security
**Chain rationale**:
- `database-reviewer` gates the additive migration and the owner filters in the five modules that read `meals`.
- `security-reviewer` closes the chain, because this step sets the ownership rule that every later access check depends on.

```bash
/ecc:orchestrate custom "ecc:tdd-guide,ecc:database-reviewer,ecc:typescript-reviewer,ecc:security-reviewer" "[Plan: .claude/prds/chef-dishes-menus.prd.md#step-1] Make meals the chef-owned dish: add nullable chef_profile_id (owner) and created_by_user_id (author), keep Lab's Food rows unowned and editable by any admin, scope legacy /admin/meals writes to unowned rows, add an explicit owner filter in every module reading meals. Acceptance: bookings, quotes, shopping-list and stats tests stay green; /admin/meals PATCH on a chef-owned meal is refused; migration additive, not applied."
```

## Step 2 — A chef can publish a dish

**Intent**: A chef creates, edits, publishes and unpublishes their own dishes behind the blocking checks of §3.3. Those checks are `CHEF_NOT_VERIFIED` and an explicit allergen declaration. Ingredients are validated as the list shopping lists read, on the chef routes and on the legacy admin routes.
**Tags**: impl, db, security
**Chain rationale**:
- New columns (`allergensNone`, `customDiets`, `customAllergens`) need `database-reviewer`.
- `security-reviewer` closes the chain: this is the first chef write path, and the verification gate is a trust boundary.

```bash
/ecc:orchestrate custom "ecc:tdd-guide,ecc:database-reviewer,ecc:typescript-reviewer,ecc:security-reviewer" "[Plan: .claude/prds/chef-dishes-menus.prd.md#step-2] Chef dish routes: create, edit, publish, unpublish own dishes with §3.3 blocking checks: CHEF_NOT_VERIFIED, explicit allergens (non-empty or allergensNone; customAllergens never count), free-text customDiets/customAllergens. Validate recipe.ingredients as a list of {name, qty, unit, aisle} on chef and /admin/meals writes. Acceptance: each blocking code refuses publish; a list is accepted, an object refused; a chef cannot touch another chef's dish."
```

## Step 3 — A chef can publish a week

**Intent**: A chef composes menus from their own dishes. Dishes and menus are many-to-many, and menus carry the same owner and author split as dishes. Each menu carries `shoppingIncluded`, `false` at creation. Publishing a menu publishes its draft dishes all-or-nothing. The chef assigns one menu per week to the vitrine.
**Tags**: impl, db, security
**Chain rationale**:
- A join table and a week-assignment table need `database-reviewer`.
- `security-reviewer` closes the chain, because a menu must never reference another chef's dish.

```bash
/ecc:orchestrate custom "ecc:tdd-guide,ecc:database-reviewer,ecc:typescript-reviewer,ecc:security-reviewer" "[Plan: .claude/prds/chef-dishes-menus.prd.md#step-3] Chef menus: several of the chef's own dishes (many-to-many, dish reusable), owner and author split as on meals, shoppingIncluded false at creation; publishing a menu publishes its draft dishes all-or-nothing, never lifting suspended; one menu per week on the vitrine, null for none. Acceptance: publish fails listing every failing dish; a suspended dish drops out without unpublishing its menus; a chef cannot add another chef's dish."
```

## Step 4 — A chef can start from Lab's Food

**Intent**:
- Lab's Food authors unowned dishes and menus. Every chef can preview them, without the recipe, and adopt one as a draft copy with lineage and an audit-log consent row.
- An offer is visible to one chef only. Accepting it transfers the row.
- A safety-relevant edit to a suggestion flags its copies `source-changed`.

**Tags**: impl, db, security
**Chain rationale**:
- Lineage, the offer column and idempotent adoption need `database-reviewer`.
- `security-reviewer` closes the chain. This step is where one chef could see another chef's offer, or copy content that isn't a suggestion.

```bash
/ecc:orchestrate custom "ecc:tdd-guide,ecc:database-reviewer,ecc:typescript-reviewer,ecc:security-reviewer" "[Plan: .claude/prds/chef-dishes-menus.prd.md#step-4] Lab's Food suggestions and offers: admins author unowned dishes and menus; every chef previews suggestions without recipe and adopts one as a draft copy, idempotent per (chef, source), with lineage and an audit-log consent row; an offer is visible to one chef only, accepting transfers the row, declining leaves it with Lab's Food; a safety edit to a suggestion flags copies source-changed and notifies chefs. Acceptance: double adopt returns the same copy; a chef never sees another chef's offer; no preview carries a recipe."
```

## Step 5 — The public page lists cooks, not dishes

**Intent**: `GET /menus/week` serves one card per chef for the week. It has filters and a rotation seeded each month. Chefs without a menu come last and are marked. No recipe ever appears. Each chef also gets a public page with badges from their validated KYC documents. `GET /menus/current` is deprecated, and its calls are logged.
**Tags**: impl, security
**Chain rationale**: this is a public, unauthenticated read over chef content. `security-reviewer` closes the chain to confirm that no recipe field and no personal data leaks.

```bash
/ecc:orchestrate custom "ecc:tdd-guide,ecc:typescript-reviewer,ecc:security-reviewer" "[Plan: .claude/prds/chef-dishes-menus.prd.md#step-5] Public GET /menus/week: one card per chef covering the area and not fully booked; area, diet, shopping and text filters; coveredDiets as the menu-wide intersection; monthly-seeded rotation above a relevance floor; no-menu chefs last and marked; never ingredients or steps. Public chef page with KYC-derived badges. Deprecate GET /menus/current, log each call. Acceptance: no recipe field in any response; order stable within a month. Out of scope: Removing GET /menus/current and the menu_weeks model."
```

## Step 6 — Admins can moderate after the fact

**Intent**: A review queue shows content in four cases: never reviewed, edited after review, republished after suspension, or source-changed. Admins can mark an item reviewed in one click. They can also remove it with a reason the chef reads verbatim. Free-text diets and allergens that keep recurring are surfaced so they can join the reference list.
**Tags**: impl, db, security
**Chain rationale**:
- Review-state columns and the queue query need `database-reviewer`.
- `security-reviewer` closes the chain: the routes are admin-only, and suspension has to take content off public reads immediately.

```bash
/ecc:orchestrate custom "ecc:tdd-guide,ecc:database-reviewer,ecc:typescript-reviewer,ecc:security-reviewer" "[Plan: .claude/prds/chef-dishes-menus.prd.md#step-6] Admin review queue over chef dishes and menus: never-reviewed, edited-after-review, republished-after-suspension and source-changed items, oldest first; one-click reviewed; suspension with a mandatory 15-500 character reason the chef reads verbatim, audited; recurring free-text diets and allergens surfaced. Admins only. Acceptance: each queue reason surfaces its item; reason length enforced; suspended content leaves public reads at once."
```

## Step 7 — Dishes have photographs

**Intent**: Dish photos use a presigned upload to Cloudflare R2, mirroring the KYC flow. The file type and size are restricted, and each object is stored under the owning chef. The photo is moderated with the dish.
**Tags**: impl, security
**Chain rationale**:
- `security-reviewer` closes the chain, because an upload path must not let anyone host arbitrary files.
- R2 speaks S3, so check the SDK already installed for Supabase before adding one. The `docs-lookup` step was dropped to keep the chain short.

```bash
/ecc:orchestrate custom "ecc:tdd-guide,ecc:typescript-reviewer,ecc:security-reviewer" "[Plan: .claude/prds/chef-dishes-menus.prd.md#step-7] Dish photos on Cloudflare R2: presigned upload mirroring the KYC flow (upload-url then confirm), a closed list of image types, a size cap, every object under the owning chef's prefix; a new or changed photo sends the dish back to the review queue. Acceptance: wrong type or oversize refused; a chef cannot upload for another chef's dish; confirm rejects an object that was never uploaded."
```

## Step 8a — Recipe versions and the fiche recette

**Intent**:
- Each recipe edit creates a new version.
- A booking pins the current version. The chef may re-pin it before the prestation; re-pinning is audited.
- The fiche is scaled to the booked portions. It flags a newer version and shows both version numbers.

**Tags**: impl, db, security
**Chain rationale**:
- `database-reviewer` gates the version table and the pin on bookings.
- `security-reviewer` closes the chain, because the fiche is where a recipe is legitimately exposed. It must reach only the booking's client and admins.

```bash
/ecc:orchestrate custom "ecc:tdd-guide,ecc:database-reviewer,ecc:typescript-reviewer,ecc:security-reviewer" "[Plan: .claude/prds/chef-dishes-menus.prd.md#step-8] Recipe versioning: each recipe edit is a new version; a booking pins the current version at booking; the chef may re-pin before the prestation, audited. Fiche recette scaled to the booked portions, flagged when a newer version exists with pinned and current numbers. Acceptance: editing a recipe never changes a pinned fiche; the flag carries both numbers; only the booking's client and admins read the fiche."
```

## Step 8b — Shopping list and culinary map

**Intent**:
- Each prestation gets a shopping list aggregated from the pinned recipes. The chef can correct it; corrections survive recalculation and can be reset. Re-pinning regenerates the list.
- The client's culinary map counts only prestations that were delivered.

**Tags**: impl, db
**Chain rationale**:
- A corrections table and aggregation queries need `database-reviewer`.
- `typescript-reviewer` closes the chain; access follows the booking's existing rules.

```bash
/ecc:orchestrate custom "ecc:tdd-guide,ecc:database-reviewer,ecc:typescript-reviewer" "[Plan: .claude/prds/chef-dishes-menus.prd.md#step-8] Per-prestation shopping list from the pinned recipes: scaled, deduplicated by (name, unit), grouped by aisle; chef corrections survive recalculation, with a reset; re-pin regenerates. Culinary map keyed by ISO alpha-2 and numeric codes, counting delivered prestations only. Acceptance: a correction survives a recalculation; reset restores the computed list; undelivered prestations never count. Out of scope: AI-generated shopping lists."
```

---

## Batch execution

```bash
/ecc:orchestrate custom "ecc:tdd-guide,ecc:database-reviewer,ecc:typescript-reviewer,ecc:security-reviewer" "[Plan: .claude/prds/chef-dishes-menus.prd.md#step-1] Make meals the chef-owned dish: add nullable chef_profile_id (owner) and created_by_user_id (author), keep Lab's Food rows unowned and editable by any admin, scope legacy /admin/meals writes to unowned rows, add an explicit owner filter in every module reading meals. Acceptance: bookings, quotes, shopping-list and stats tests stay green; /admin/meals PATCH on a chef-owned meal is refused; migration additive, not applied."
/ecc:orchestrate custom "ecc:tdd-guide,ecc:database-reviewer,ecc:typescript-reviewer,ecc:security-reviewer" "[Plan: .claude/prds/chef-dishes-menus.prd.md#step-2] Chef dish routes: create, edit, publish, unpublish own dishes with §3.3 blocking checks: CHEF_NOT_VERIFIED, explicit allergens (non-empty or allergensNone; customAllergens never count), free-text customDiets/customAllergens. Validate recipe.ingredients as a list of {name, qty, unit, aisle} on chef and /admin/meals writes. Acceptance: each blocking code refuses publish; a list is accepted, an object refused; a chef cannot touch another chef's dish."
/ecc:orchestrate custom "ecc:tdd-guide,ecc:database-reviewer,ecc:typescript-reviewer,ecc:security-reviewer" "[Plan: .claude/prds/chef-dishes-menus.prd.md#step-3] Chef menus: several of the chef's own dishes (many-to-many, dish reusable), owner and author split as on meals, shoppingIncluded false at creation; publishing a menu publishes its draft dishes all-or-nothing, never lifting suspended; one menu per week on the vitrine, null for none. Acceptance: publish fails listing every failing dish; a suspended dish drops out without unpublishing its menus; a chef cannot add another chef's dish."
/ecc:orchestrate custom "ecc:tdd-guide,ecc:database-reviewer,ecc:typescript-reviewer,ecc:security-reviewer" "[Plan: .claude/prds/chef-dishes-menus.prd.md#step-4] Lab's Food suggestions and offers: admins author unowned dishes and menus; every chef previews suggestions without recipe and adopts one as a draft copy, idempotent per (chef, source), with lineage and an audit-log consent row; an offer is visible to one chef only, accepting transfers the row, declining leaves it with Lab's Food; a safety edit to a suggestion flags copies source-changed and notifies chefs. Acceptance: double adopt returns the same copy; a chef never sees another chef's offer; no preview carries a recipe."
/ecc:orchestrate custom "ecc:tdd-guide,ecc:typescript-reviewer,ecc:security-reviewer" "[Plan: .claude/prds/chef-dishes-menus.prd.md#step-5] Public GET /menus/week: one card per chef covering the area and not fully booked; area, diet, shopping and text filters; coveredDiets as the menu-wide intersection; monthly-seeded rotation above a relevance floor; no-menu chefs last and marked; never ingredients or steps. Public chef page with KYC-derived badges. Deprecate GET /menus/current, log each call. Acceptance: no recipe field in any response; order stable within a month. Out of scope: Removing GET /menus/current and the menu_weeks model."
/ecc:orchestrate custom "ecc:tdd-guide,ecc:database-reviewer,ecc:typescript-reviewer,ecc:security-reviewer" "[Plan: .claude/prds/chef-dishes-menus.prd.md#step-6] Admin review queue over chef dishes and menus: never-reviewed, edited-after-review, republished-after-suspension and source-changed items, oldest first; one-click reviewed; suspension with a mandatory 15-500 character reason the chef reads verbatim, audited; recurring free-text diets and allergens surfaced. Admins only. Acceptance: each queue reason surfaces its item; reason length enforced; suspended content leaves public reads at once."
/ecc:orchestrate custom "ecc:tdd-guide,ecc:typescript-reviewer,ecc:security-reviewer" "[Plan: .claude/prds/chef-dishes-menus.prd.md#step-7] Dish photos on Cloudflare R2: presigned upload mirroring the KYC flow (upload-url then confirm), a closed list of image types, a size cap, every object under the owning chef's prefix; a new or changed photo sends the dish back to the review queue. Acceptance: wrong type or oversize refused; a chef cannot upload for another chef's dish; confirm rejects an object that was never uploaded."
/ecc:orchestrate custom "ecc:tdd-guide,ecc:database-reviewer,ecc:typescript-reviewer,ecc:security-reviewer" "[Plan: .claude/prds/chef-dishes-menus.prd.md#step-8] Recipe versioning: each recipe edit is a new version; a booking pins the current version at booking; the chef may re-pin before the prestation, audited. Fiche recette scaled to the booked portions, flagged when a newer version exists with pinned and current numbers. Acceptance: editing a recipe never changes a pinned fiche; the flag carries both numbers; only the booking's client and admins read the fiche."
/ecc:orchestrate custom "ecc:tdd-guide,ecc:database-reviewer,ecc:typescript-reviewer" "[Plan: .claude/prds/chef-dishes-menus.prd.md#step-8] Per-prestation shopping list from the pinned recipes: scaled, deduplicated by (name, unit), grouped by aisle; chef corrections survive recalculation, with a reset; re-pin regenerates. Culinary map keyed by ISO alpha-2 and numeric codes, counting delivered prestations only. Acceptance: a correction survives a recalculation; reset restores the computed list; undelivered prestations never count. Out of scope: AI-generated shopping lists."
```
