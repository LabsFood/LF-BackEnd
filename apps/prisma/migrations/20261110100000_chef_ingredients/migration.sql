-- BLK-33 (2026-11-10): the Lab's Food admin fills the common ingredient list; a
-- batch cooker may adopt an entry and edit their own version (name, other names,
-- diets, months in season). Their dishes are classified from it, everyone else's
-- from the common entry. Removing the version falls back on the common entry.
CREATE TABLE IF NOT EXISTS "chef_ingredients" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "chef_profile_id" UUID NOT NULL,
  "catalog_ingredient_id" UUID NOT NULL,
  "name" VARCHAR(120) NOT NULL,
  "aliases" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "diets" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "season_months" INTEGER[] NOT NULL DEFAULT ARRAY[]::INTEGER[],
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  CONSTRAINT "chef_ingredients_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "chk_chef_ingredients_months"
    CHECK ("season_months" <@ ARRAY[1,2,3,4,5,6,7,8,9,10,11,12]),
  CONSTRAINT "fk_chef_ingredients_chef_profile_id" FOREIGN KEY ("chef_profile_id")
    REFERENCES "chef_profiles"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT "fk_chef_ingredients_catalog_ingredient_id" FOREIGN KEY ("catalog_ingredient_id")
    REFERENCES "catalog_ingredients"("id") ON DELETE CASCADE ON UPDATE NO ACTION
);

-- One version per chef and entry; also the lookup when a chef's dish is classified.
CREATE UNIQUE INDEX IF NOT EXISTS "uq_chef_ingredients_chef_catalog"
  ON "chef_ingredients" ("chef_profile_id", "catalog_ingredient_id");

-- An admin's change to an entry reclassifies the dishes of chefs without a version.
CREATE INDEX IF NOT EXISTS "ix_chef_ingredients_catalog_ingredient_id"
  ON "chef_ingredients" ("catalog_ingredient_id");
