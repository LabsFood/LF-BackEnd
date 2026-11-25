-- Recettes lot 2, §4.8: how a recipe is classified. Diets and seasons are
-- computed from the common ingredient list and stored with the dish (recomputed
-- when the list changes); halal and kosher are declared; profiles come from an
-- editable list; personal tags are the chef's alone and never public.
ALTER TABLE "meals"
ADD COLUMN IF NOT EXISTS "declared_diets" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
ADD COLUMN IF NOT EXISTS "profiles" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
ADD COLUMN IF NOT EXISTS "personal_tags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
ADD COLUMN IF NOT EXISTS "seasons_override" INTEGER[] NOT NULL DEFAULT ARRAY[]::INTEGER[],
ADD COLUMN IF NOT EXISTS "classification" JSONB;

DO $$
BEGIN
  ALTER TABLE "meals" ADD CONSTRAINT "chk_meals_seasons_override"
    CHECK ("seasons_override" <@ ARRAY[1,2,3,4,5,6,7,8,9,10,11,12]);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
