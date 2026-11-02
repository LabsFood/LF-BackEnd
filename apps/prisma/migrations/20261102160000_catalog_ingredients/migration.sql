-- Recettes lot 2, §4.10: the common ingredient list, filled by the Lab's Food
-- admin (BLK-33). A recipe line may point to it (`catalogIngredientId` in the
-- ingredients JSON); diets and seasons are computed from it.
CREATE TABLE IF NOT EXISTS "catalog_ingredients" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "name" VARCHAR(120) NOT NULL,
  "aliases" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "diets" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "season_months" INTEGER[] NOT NULL DEFAULT ARRAY[]::INTEGER[],
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  CONSTRAINT "catalog_ingredients_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "chk_catalog_ingredients_months"
    CHECK ("season_months" <@ ARRAY[1,2,3,4,5,6,7,8,9,10,11,12])
);

CREATE UNIQUE INDEX IF NOT EXISTS "uq_catalog_ingredients_name" ON "catalog_ingredients" ("name");
