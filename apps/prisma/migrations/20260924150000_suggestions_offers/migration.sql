-- FLOW-02 milestone 4: Lab's Food suggestions, adoption and offers (§6, PRD).
--
-- A suggestion is a published meal or menu with no owner and no offer. Adopting
-- one copies it into the chef's space as a draft; `source_*_id` and
-- `source_version` record which suggestion, at which version, and the unique
-- (chef, source) index makes adoption idempotent (NULLs never collide). An offer
-- is Lab's Food content prepared for one chef (`offered_to_chef_profile_id`); only
-- that chef sees it, and it becomes theirs only when they accept.
-- `source_changed_at` flags a copy whose suggestion later changed its allergens,
-- diets or country. Additive: every column is nullable.
-- AlterTable
ALTER TABLE "meals" ADD COLUMN     "offered_to_chef_profile_id" UUID,
ADD COLUMN     "source_changed_at" TIMESTAMPTZ(6),
ADD COLUMN     "source_meal_id" UUID,
ADD COLUMN     "source_version" TIMESTAMPTZ(6);

-- AlterTable
ALTER TABLE "menus" ADD COLUMN     "offered_to_chef_profile_id" UUID,
ADD COLUMN     "source_menu_id" UUID,
ADD COLUMN     "source_version" TIMESTAMPTZ(6);

-- CreateIndex
CREATE INDEX "ix_meals_offered_to_chef_profile_id" ON "meals"("offered_to_chef_profile_id");

-- CreateIndex
CREATE INDEX "ix_meals_source_meal_id" ON "meals"("source_meal_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_meals_chef_profile_source" ON "meals"("chef_profile_id", "source_meal_id");

-- CreateIndex
CREATE INDEX "ix_menus_offered_to_chef_profile_id" ON "menus"("offered_to_chef_profile_id");

-- CreateIndex
CREATE INDEX "ix_menus_source_menu_id" ON "menus"("source_menu_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_menus_chef_profile_source" ON "menus"("chef_profile_id", "source_menu_id");

-- AddForeignKey
ALTER TABLE "meals" ADD CONSTRAINT "fk_meals_source_meal_id" FOREIGN KEY ("source_meal_id") REFERENCES "meals"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "meals" ADD CONSTRAINT "fk_meals_offered_to_chef_profile_id" FOREIGN KEY ("offered_to_chef_profile_id") REFERENCES "chef_profiles"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "menus" ADD CONSTRAINT "fk_menus_source_menu_id" FOREIGN KEY ("source_menu_id") REFERENCES "menus"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "menus" ADD CONSTRAINT "fk_menus_offered_to_chef_profile_id" FOREIGN KEY ("offered_to_chef_profile_id") REFERENCES "chef_profiles"("id") ON DELETE SET NULL ON UPDATE NO ACTION;


-- An offer is Lab's Food content: never owned at the same time. If the chef it was
-- offered to is deleted, it simply returns to Lab's Food (SET NULL above).
ALTER TABLE "meals" ADD CONSTRAINT "chk_meals_offer_unowned"
  CHECK ("offered_to_chef_profile_id" IS NULL OR "chef_profile_id" IS NULL);

ALTER TABLE "menus" ADD CONSTRAINT "chk_menus_offer_unowned"
  CHECK ("offered_to_chef_profile_id" IS NULL OR "chef_profile_id" IS NULL);

-- An offer is never published. Otherwise, should the chef it was offered to be
-- deleted, the SET NULL above would turn it into a public suggestion that no chef
-- consented to. The API refuses it first (409 OFFER_PENDING).
ALTER TABLE "meals" ADD CONSTRAINT "chk_meals_offer_unpublished"
  CHECK ("offered_to_chef_profile_id" IS NULL OR "status"::text <> 'published');

ALTER TABLE "menus" ADD CONSTRAINT "chk_menus_offer_unpublished"
  CHECK ("offered_to_chef_profile_id" IS NULL OR "status"::text <> 'published');
