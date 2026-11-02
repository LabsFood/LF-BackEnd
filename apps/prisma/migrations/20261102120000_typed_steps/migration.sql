-- Recettes lot 2, §4.5: a step becomes { order, text, type, durationMinutes }.
-- Existing steps keep their text and order, without a type: the recipe is not
-- "Prête" until the chef types them. Guarded on the column type, so a replay after
-- a partial run does nothing twice.

DO $$
BEGIN
  IF (SELECT data_type FROM information_schema.columns
      WHERE table_name = 'meals' AND column_name = 'steps') = 'ARRAY' THEN
    ALTER TABLE "meals" ADD COLUMN IF NOT EXISTS "steps_typed" JSONB NOT NULL DEFAULT '[]'::jsonb;
    UPDATE "meals" m SET "steps_typed" = (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'order', s.ord, 'text', s.txt, 'type', NULL, 'durationMinutes', NULL
      ) ORDER BY s.ord), '[]'::jsonb)
      FROM unnest(m."steps") WITH ORDINALITY AS s(txt, ord)
    )
    WHERE cardinality(m."steps") > 0;
    ALTER TABLE "meals" DROP COLUMN "steps";
    ALTER TABLE "meals" RENAME COLUMN "steps_typed" TO "steps";
  END IF;

  IF (SELECT data_type FROM information_schema.columns
      WHERE table_name = 'meal_recipe_versions' AND column_name = 'steps') = 'ARRAY' THEN
    ALTER TABLE "meal_recipe_versions" ADD COLUMN IF NOT EXISTS "steps_typed" JSONB NOT NULL DEFAULT '[]'::jsonb;
    UPDATE "meal_recipe_versions" v SET "steps_typed" = (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'order', s.ord, 'text', s.txt, 'type', NULL, 'durationMinutes', NULL
      ) ORDER BY s.ord), '[]'::jsonb)
      FROM unnest(v."steps") WITH ORDINALITY AS s(txt, ord)
    )
    WHERE cardinality(v."steps") > 0;
    ALTER TABLE "meal_recipe_versions" DROP COLUMN "steps";
    ALTER TABLE "meal_recipe_versions" RENAME COLUMN "steps_typed" TO "steps";
  END IF;
END $$;
