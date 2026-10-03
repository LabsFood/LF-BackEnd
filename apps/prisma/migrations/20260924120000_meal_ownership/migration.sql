-- FLOW-02 milestone 1: a meal gets an owner and an author.
--
-- `chef_profile_id` is the owner: set for a batch cooker's dish, null for Lab's Food
-- content. `created_by_user_id` is the author, for attribution only. Both are
-- nullable, so every existing row becomes an unowned Lab's Food meal with an
-- unknown author, which is what they are. Additive: nothing is rewritten.
ALTER TABLE "meals" ADD COLUMN     "chef_profile_id" UUID,
ADD COLUMN     "created_by_user_id" UUID;

CREATE INDEX "ix_meals_chef_profile_id" ON "meals"("chef_profile_id");

-- Backs the SET NULL below when a user is deleted.
CREATE INDEX "ix_meals_created_by_user_id" ON "meals"("created_by_user_id");

-- A chef's dishes go with the chef. Nulling the owner instead would turn them into
-- public Lab's Food suggestions. booking_meals.meal_id is RESTRICT, so a dish that
-- was booked still blocks the deletion.
ALTER TABLE "meals" ADD CONSTRAINT "fk_meals_chef_profile_id" FOREIGN KEY ("chef_profile_id") REFERENCES "chef_profiles"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- The content outlives its author.
ALTER TABLE "meals" ADD CONSTRAINT "fk_meals_created_by_user_id" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
