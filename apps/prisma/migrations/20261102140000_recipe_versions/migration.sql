-- Recettes lot 2, R6: saving a draft no longer makes a recipe version. A version
-- is made once the recipe is "Prête" again, or when the allergens are confirmed,
-- and its content is kept at that moment.
ALTER TABLE "meals" ADD COLUMN IF NOT EXISTS "version_pending" BOOLEAN NOT NULL DEFAULT false;

-- Every dish's current version kept as it stands now. Until this lot each change
-- made a new version, so the current content is that version's; from now on a
-- draft can drift from it, and a booking must still cook from the version.
INSERT INTO "meal_recipe_versions" ("meal_id", "version", "portions", "ingredients", "steps", "reheating", "storage")
SELECT m."id", m."recipe_version", m."portions", m."ingredients", m."steps", m."reheating", m."storage"
FROM "meals" m
WHERE NOT EXISTS (
  SELECT 1 FROM "meal_recipe_versions" v
  WHERE v."meal_id" = m."id" AND v."version" = m."recipe_version"
);
