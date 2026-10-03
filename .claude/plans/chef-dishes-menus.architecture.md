# Architecture: FLOW-02 dishes, menus, publication and moderation

**PRD**: `.claude/prds/chef-dishes-menus.prd.md` · **Spec**: `LF_Codespace/FLOW-02-plats-et-menus.md` (read-only)
**Branch**: `feat/chef-dishes-menus` (#38), with #40 (which contains #37) merged in as `17e02c5`. Retarget #38 onto `chore/api-docs-and-cms-removal` when it is pushed.
**Delivery**: one commit per milestone, after build, lint, tests and the milestone's review chain pass. Nothing is pushed until you ask.

## Settled choices

- **Values**:
  - Diet, allergen and category values are English kebab-case ids. `GET /referentials/*` serves their French labels.
  - Difficulty keeps `easy | medium | hard`.
- **Photos**: Cloudflare R2 through `@aws-sdk/client-s3` and `@aws-sdk/s3-request-presigner`.
- **Two existing decisions stand**:
  - Admin `topMeals` counts only Lab's Food meals.
  - Deleting a chef profile deletes that chef's dishes. A dish that has been booked still blocks the deletion.

## Where the spec is followed loosely, and why

| Spec | Built | Why |
|---|---|---|
| `POST/PATCH /admin/suggestions` | `/admin/meals` (from M1) for Lab's Food dishes, and a new `/admin/menus` for Lab's Food menus | A suggestion *is* an unowned Lab's Food row (PRD decision). A second endpoint writing the same rows would be two sources of truth. |
| `{ items, page, perPage, total }` | `{ data, meta }` | Every paginated route in this API already answers that way. |
| One mixed review queue | `GET /admin/dishes?review=pending` and `GET /admin/menus?review=pending` | These are the spec's own paths; each list is sorted oldest first. |
| `chef-missions/:missionId` | a mission is a `booking`. Paths follow the spec; the id is the booking id | There is no separate missions table. |
| Card fields `avatarUrl`, `rating`, `reviewCount`, `languages` | `null` or `[]` | No table holds them yet. Swagger says so. |
| `sessionFromCents` = the chef's net plus the commission | the chef's cheapest active `service_offers.price_cents` | There is no commission on this base: it lives on the payments branch. `ponytail:` comment with the upgrade path. |
| The prestation pins the recipe "at booking" | pinned when the shopping list or fiche is first generated, through one `pinRecipes(bookingId)` helper that booking creation will call | `POST /bookings` answers 501 today. The payments branch will add the call. |

## Code layout

A new module holds FLOW-02; the existing modules only receive owner rules.

```
src/modules/dishes/
  domain/
    dishes.rules.ts           pure: reference lists, publish checks, safety-field diff,
                              coveredDiets, monthly rotation, recipe scaling
    countries.ts              ISO alpha-2 -> { numeric, name }; validates `country`
  chef-content.service.ts     resolves the calling chef, owner checks, CHEF_NOT_VERIFIED
  dishes.service.ts           M2: chef dish create, edit, publish, unpublish
  menus.service.ts            M3: chef menus, publishing, showcase weeks
  suggestions.service.ts      M4: previews, adoption, offers, source-changed
  vitrine.service.ts          M5: GET /menus/week, /chefs/:id, /chefs/:id/showcase
  moderation.service.ts       M6: review queue, review, suspend and lift, custom values
  dish-photos.service.ts      M7: presigned upload, confirm, remove
  r2-storage.service.ts       M7: S3 client on R2; 503 PHOTOS_UNAVAILABLE when unconfigured
  recipes.service.ts          M8: versions, pinning, fiche, culinary map
  dishes.mailer.ts            M4 and M6: source-changed, content suspended
  me-content.controller.ts    /me/dishes, /me/menus, /me/showcase, /me/suggestions, /me/offers
  public-vitrine.controller.ts  /menus/week, /chefs/:id, /chefs/:id/showcase
  admin-content.controller.ts   /admin/dishes, /admin/menus, /admin/chefs/:id/{dishes,menus}
  chef-missions.controller.ts   /chef-missions/:id/…, /me/culinary-map
  dto/…  swagger-examples.ts  dishes.module.ts
```

`shopping-lists.service.ts` is reused in M8. It is extended rather than duplicated, because its admin route stays.

## Data model, one migration per milestone (none applied)

| M | Migration | Changes |
|---|---|---|
| 1 | `…_meal_ownership` | `meals.chef_profile_id` (FK, cascade), `meals.created_by_user_id` (FK, set null), `ix_meals_chef_profile_id` |
| 2 | `…_chef_dishes` | `meals` gains `allergens_none bool`, `custom_diets text[]`, `custom_allergens text[]`, `category varchar(24)`, `cook_time int`, `reheating jsonb`, `storage jsonb`, `published_at timestamptz` |
| 3 | `…_chef_menus` | enum `meal_status` gains `suspended`. New tables `menus`, `menu_dishes` (menu, meal, position) and `chef_showcase_weeks` (chef, `week_start` date, menu). CHECK on `meals` and `menus`: `status::text <> 'suspended' OR chef_profile_id IS NOT NULL`. The text cast avoids Postgres refusing a new enum value used in the same transaction |
| 4 | `…_suggestions_offers` | `meals` and `menus` gain `source_*_id` (FK, set null), `source_version timestamptz`, `offered_to_chef_profile_id` (FK, cascade), `source_changed_at`. `UNIQUE (chef_profile_id, source_*_id)` makes adoption idempotent; NULLs never collide |
| 6 | `…_moderation` | `meals` and `menus` gain `reviewed_at`, `review_pending_since`, `review_reason varchar(40)`, `moderation_reason text`, `moderation_reason_code varchar(40)`, `moderated_at` |
| 8 | `…_recipe_versions` | new table `meal_recipe_versions` (meal, version, ingredients, steps, reheating, storage, portions; unique on meal and version). `meals.recipe_version int`, `booking_meals.recipe_version int`. `shopping_items` gains `qty numeric(10,2)`, `unit varchar(32)`, `edited bool` and `removed bool`; `quantity` is kept for the existing admin view |

Milestones 5 and 7 need no schema change. Photos reuse `meals.image_url`.

**Row kinds, all derived and never stored:**
- **chef dish**: `chef_profile_id` is set.
- **offer**: no owner, and `offered_to` is set.
- **suggestion**: no owner, no `offered_to`, and `published`.
- **Lab's Food draft**: no owner, no `offered_to`, and not published.

## Routes

| M | Route | Who | Notes |
|---|---|---|---|
| 1 | `/admin/meals` (list, create, update, delete), `POST /admin/menu-weeks` | admin | Lab's Food rows only. Otherwise `403 CONTENT_NOT_OWNED`; an unknown id gets `404` |
| 2 | `GET, POST /me/dishes`; `GET, PATCH, DELETE /me/dishes/:id`; `POST /me/dishes/:id/publish` and `/unpublish` | chef | Every write needs a verified chef, else `403 CHEF_NOT_VERIFIED`. Publishing also needs a valid dossier and passes §3.3: `422 VALIDATION_FAILED` or `422 ALLERGENS_REQUIRED` |
| 2 | `GET /referentials/allergens`, `/diets`, `/dish-categories` | public | id plus French label |
| 3 | `GET, POST /me/menus`; `GET, PATCH, DELETE /me/menus/:id`; `POST /me/menus/:id/publish` and `/unpublish`; `GET, PUT /me/showcase/weeks` | chef | Publishing publishes the menu's draft dishes, all or nothing. A failure answers `422 MENU_NOT_PUBLISHABLE` with every failing dish. `weekStart` must be a Monday |
| 4 | `GET, POST, PATCH /admin/menus`; `POST, DELETE /admin/{meals,menus}/:id/offer` | admin | Lab's Food menus, and offers to one chef |
| 4 | `GET /me/suggestions`; `POST /me/suggestions/:id/adopt` (`{ consent: true }`, else `422 CONSENT_REQUIRED`) | chef | Previews carry no recipe. Adopting twice returns the same copy. The audit row is the consent proof |
| 4 | `GET /me/offers`; `POST /me/offers/:id/accept`, `/decline` | chef | Accepting transfers the row. Declining returns it to Lab's Food as a draft, so an offer never turns into a public suggestion by accident |
| 5 | `GET /menus/week`, `GET /chefs/:id`, `GET /chefs/:id/showcase` | public | Only chefs both `isVerified` and `isActive`, and only published content. No recipe field |
| 5 | `GET /menus/current` | public | `deprecated: true`, and every call is logged |
| 6 | `GET /admin/dishes`, `GET /admin/menus` (`?review=pending`, `?chefId=`); `GET /admin/chefs/:id/dishes`, `/menus` | admin | Admins see full recipes (§8) |
| 6 | `POST /admin/{dishes,menus}/:id/review`; `PATCH /admin/{dishes,menus}/:id/moderation` | admin | The reason is 15–500 characters, else `422 REASON_REQUIRED`. Suspending notifies the chef by email and is audited |
| 6 | `GET /admin/dishes/custom-values` | admin | Recurring free-text diets and allergens, with counts |
| 7 | `POST /me/dishes/:id/photo/upload-url` and `/confirm`; `DELETE /me/dishes/:id/photo` | chef | jpeg, png or webp, 5 MB at most, stored under `chefs/{chefId}/dishes/{dishId}/`. A new photo puts the dish back in the review queue |
| 8 | `GET /chef-missions/:id/dishes/:dishId/recipe-sheet?portions=`; `GET, PUT /chef-missions/:id/shopping-list`; `POST …/shopping-list/reset`; `POST …/recipes/repin` | chef of the booking, admin; the client reads once the booking is `completed` | Re-pinning is refused once the prestation has started. It is audited and regenerates the list |
| 8 | `GET /me/culinary-map` | client | Counts `completed` bookings only |

## Access rule, one place

`ChefContentService.ownDish(chefProfileId, id)` and `ownMenu(…)` apply one rule on every chef path:
- An unknown id gives `404`.
- Another chef's row gives `403 CONTENT_NOT_OWNED` on writes and `404` on reads, so a chef can't probe for other chefs' ids.

Admin and public reads never go through it. The §8 access table is also written as one test that goes through every actor.

## Testing

- Pure rules are tested directly: publish checks, coveredDiets, rotation, scaling, safety diff, country table.
- Services use a mocked `PrismaService`, as the existing specs do.
- Each milestone passes `npm run build`, `npm run lint`, `npx jest` (apart from the known TTL test) and the OpenAPI check script before its commit.

## Configuration added

- Brevo templates: `BREVO_TPL_SOURCE_CHANGED`, `BREVO_TPL_CONTENT_SUSPENDED`, `BREVO_TPL_MENU_DISH_SUSPENDED`.
- R2: `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, `R2_PUBLIC_BASE_URL`.

All are optional: an email without a template, or a photo route without R2, degrades the same way FLOW-01 does. Each variable goes in `.env.example` and `docs/…/railway.md`.

## Review chain per milestone

This follows `.claude/plans/chef-dishes-menus.orchestrate.md`.
- The reviewers from that chain run in parallel on the milestone's diff.
- CRITICAL and HIGH findings are fixed before the milestone's commit. MEDIUM findings are listed in the summary.
