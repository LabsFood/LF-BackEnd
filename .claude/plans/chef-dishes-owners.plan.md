# Plan: Dishes have owners (FLOW-02 milestone 1)

**Source PRD**: `.claude/prds/chef-dishes-menus.prd.md` (branch `feat/chef-dishes-menus`, #38)
**Selected Milestone**: 1 — Dishes have owners
**Complexity**: Medium. One additive migration and about 7 files.
**Branch**: `feat/chef-dishes-owners`, cut from `chore/api-docs-and-cms-removal` (#40).
- It sits on #40 because #40 rewrote the catalog DTOs and controller for Swagger. Starting from #37 would conflict.
- The stale local `feat/chef-dishes-menus-impl` (`defd04f`) is left untouched.

## Summary

- `meals` gets two separate columns: `chef_profile_id` (owner) and `created_by_user_id` (author).
- A Lab's Food meal is a row with no owner.
- The legacy `/admin/meals` and `/admin/menu-weeks` routes only ever touch Lab's Food rows.
- Every module that reads `meals` states its owner rule in the code.
- The two paths that expose `ingredients` and `steps` where §1 and §8 forbid it stop returning them.

## What each reader does

| Reader | Today | After |
|---|---|---|
| `GET /admin/meals` | every meal | Lab's Food meals only (`chefProfileId: null`) |
| `POST /admin/meals` | creates the meal | creates an unowned meal with `createdByUserId` set to the admin |
| `PATCH` / `DELETE /admin/meals/:id` | any meal | Lab's Food meals only. A chef's dish gets `403 CONTENT_NOT_OWNED`; an unknown id gets `404` |
| `POST /admin/menu-weeks` | any meal ids; an unknown id causes a 500 | Lab's Food meal ids only. A chef's dish gets `403 CONTENT_NOT_OWNED`; an unknown id gets `404` |
| `GET /menus/current` (public) | full meal, recipe included | Lab's Food meals only, without `ingredients` or `steps` (§1) |
| `GET /bookings/me/bookings/:id` (client) | full meal, recipe included | meal without `ingredients` or `steps`. The client gets the recipe from the fiche, after the prestation (§8) |
| `GET /admin/bookings/:id` | full meal | unchanged. Admins may read recipes (§8) |
| Shopping lists | every booked meal | unchanged, **stated in a comment**: a prestation's list counts every dish booked, whoever owns it |
| Admin dashboard `topMeals` | every booked meal | Lab's Food meals only, keeping today's meaning. Changing that later is a one-line `where` |
| Quotes | never read `meals` | nothing to do |

## Patterns to Mirror

| Category | Source | Pattern |
|---|---|---|
| Errors with a code | `src/modules/users/users.service.ts:377` | `new ForbiddenException({ code, message })` |
| Prisma error mapping | `src/modules/catalog/catalog.service.ts:101` | catch `PrismaClientKnownRequestError`, map `P2025` to 404 and `P2003` to 409 |
| Acting admin's id | `src/modules/chef-onboarding/chef-applications-admin.controller.ts:71` | private `adminId(user)` calls `users.findByClerkId`. `UsersModule` is already imported by `CatalogModule` |
| Schema naming | `prisma/schema.prisma` (`ChefProfile`) | snake_case `@map`, and named FKs and indexes (`fk_…`, `ix_…`) |
| Migration | `prisma/migrations/20260923120000_remove_cms_pages` | hand-checked SQL, produced by `prisma migrate diff` between the old and new schema files, not applied |
| Tests | `src/modules/catalog/catalog.service.spec.ts` | Nest `Test` module with a mocked `PrismaService`, `knownRequestError(code)` helper |
| Swagger | `src/modules/catalog/catalog.controller.ts` | method-level `@ApiTags(TAGS.adminCatalog)`, `errorExample(code, message)` responses |

## Files to Change

| File | Action | Why |
|---|---|---|
| `prisma/schema.prisma` | UPDATE | `Meal.chefProfileId`, `Meal.createdByUserId`, and the back-relations on `ChefProfile` and `User` |
| `prisma/migrations/20260924120000_meal_ownership/migration.sql` | CREATE | two nullable columns, two FKs, one index. Additive; existing rows become Lab's Food meals |
| `src/modules/catalog/catalog.service.ts` | UPDATE | owner rules on list, create, update, delete, the menu-week guard and the public menu |
| `src/modules/catalog/catalog.controller.ts` | UPDATE | pass the admin's id to `createMeal`, document `403 CONTENT_NOT_OWNED` and `404` |
| `src/modules/catalog/dto/catalog-admin.dto.ts` | UPDATE | `chefProfileId` and `createdByUserId` on `MealResponseDto` |
| `src/modules/bookings/bookings.service.ts` | UPDATE | the client detail leaves out `ingredients` and `steps` |
| `src/modules/stats/stats.service.ts` | UPDATE | explicit Lab's Food filter on `topMeals` |
| `src/modules/shopping-lists/shopping-lists.service.ts` | UPDATE | one comment stating the owner rule, no behaviour change |
| `src/modules/catalog/catalog.service.spec.ts` | UPDATE | tests first, see Task 2 |

## Tasks

### Task 1: Schema and migration
- **Action**:
  - Add the columns:
    - `chefProfileId String? @map("chef_profile_id") @db.Uuid`, relation `onDelete: Cascade`. A chef's dishes go with the chef. Nulling the owner would turn a chef's dish into a public Lab's Food suggestion.
    - `createdByUserId String? @map("created_by_user_id") @db.Uuid`, relation `onDelete: SetNull`. The content outlives its author.
    - `@@index([chefProfileId], map: "ix_meals_chef_profile_id")`.
  - Produce the SQL with `prisma migrate diff` from the old schema to the new one.
- **Mirror**: the `ChefProfile` FK naming.
- **Validate**: `npx prisma validate && npx prisma generate`. The diff SQL contains only `ADD COLUMN`, `ADD CONSTRAINT` and `CREATE INDEX`.

### Task 2: Tests first (they fail at this point)
- **Action**: add these cases to `catalog.service.spec.ts`:
  1. `listMeals` filters on `chefProfileId: null`.
  2. `createMeal(payload, adminId)` sets `createdByUserId` and never `chefProfileId`.
  3. `updateMeal` on a chef's dish throws `403 CONTENT_NOT_OWNED`; on an unknown id, `404`.
  4. `deleteMeal`: the same two cases; `P2003` still gives `409`.
  5. `createMenuWeek` with a chef's dish id throws `403`; with an unknown id, `404`; with Lab's Food ids, it creates.
  6. `getCurrentPublishedMenu` asks only for Lab's Food meals, without `ingredients` or `steps`.
- **Validate**: `npx jest src/modules/catalog` shows the new cases failing.

### Task 3: Catalog service and controller
- **Action**:
  - `update` and `delete` use `where: { id, chefProfileId: null }` (Prisma 5+ accepts filters besides the id). There is then no gap between the ownership check and the write.
  - On `P2025`, one lookup decides between `404` and `403 CONTENT_NOT_OWNED`.
  - `createMenuWeek` checks every id first with one `findMany`.
  - The controller resolves the admin's id through the `adminId()` pattern.
  - Update the Swagger responses and add the two fields to `MealResponseDto`.
- **Validate**: `npx jest src/modules/catalog` passes.

### Task 4: Other readers
- **Action**:
  - Bookings client detail: `meal: { omit: { ingredients: true, steps: true } }`.
  - `topMeals`: `where: { meal: { chefProfileId: null } }`.
  - Shopping lists: a comment only.
- **Validate**: `npm run build` (the Prisma argument shapes are type-checked).

### Task 5: Review chain
- **Action**: run the step 1 chain from `.claude/plans/chef-dishes-menus.orchestrate.md` on the diff:
  1. `database-reviewer` on the migration,
  2. `typescript-reviewer`,
  3. `security-reviewer` on the owner rule and the two recipe paths.
- **Validate**: CRITICAL and HIGH findings are fixed.

## Validation

```bash
cd apps
npx prisma validate
npm run build
npm run lint
npx jest src/modules/catalog
npm test                                  # known: 1 failing UsersService › registerClient TTL test, to ignore
node <scratchpad>/openapi.js              # OpenAPI builds, 0 problems
```

## Deferred

These are not in milestone 1. Each is added by the first milestone that uses it.

| Item | Why not now | Added by |
|---|---|---|
| `suspended` status and its CHECK (chef-owned rows only) | nothing can suspend a dish until moderation exists | M3 (a suspended dish leaves its menus) or M6 |
| Offer column (`offered_to_chef_profile_id`) | offers come with adoption | M4 |
| Chef read access to suggestions | no chef dish route exists before M2 | M4 |
| `CreateMealDto.ingredients` as a list | the PRD puts it in M2 | M2 |

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| `ON DELETE CASCADE` on the owner loses a chef's dishes when their profile is deleted | Low: `booking_meals` is `RESTRICT`, so a booked dish still blocks the deletion | the database reviewer confirms it. Alternative: `RESTRICT` plus an explicit clean-up |
| Leaving recipe fields out of the client booking detail breaks a consumer | Low: no call in `batchcooking-web` outside mocks (checked read-only) | noted in the PR |
| The migration is not applied here | Certain, by rule | the user applies it after checking production, as with the other two |

## Acceptance
- [ ] All tasks complete
- [ ] Validation passes (apart from the known TTL test)
- [ ] No legacy admin write can reach a row that has an owner
- [ ] No public or client route returns `ingredients` or `steps`
- [ ] Migration is additive and not applied
