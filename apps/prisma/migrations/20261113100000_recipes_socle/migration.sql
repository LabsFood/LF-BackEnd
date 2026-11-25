-- Recettes socle, §5.1 and §5.3: the common ingredient list becomes the one
-- source of allergens, diets and seasons. A catalog row now carries its allergens,
-- a status (a chef's private ingredient waits as `pending` for the admin) and an
-- owner (`chef_profile_id` null: the common list). A dish stores the allergens
-- computed from its ingredients and a lock version for concurrent edits.
-- `normalized_name` stays nullable: the API and the backfill fill it, since SQL
-- here has no `unaccent`.
ALTER TABLE "catalog_ingredients"
ADD COLUMN IF NOT EXISTS "normalized_name" VARCHAR(120),
ADD COLUMN IF NOT EXISTS "aisle" VARCHAR(40),
ADD COLUMN IF NOT EXISTS "allergens" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
ADD COLUMN IF NOT EXISTS "allergens_none" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS "is_basic" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS "chef_profile_id" UUID,
ADD COLUMN IF NOT EXISTS "status" VARCHAR(16) NOT NULL DEFAULT 'active',
ADD COLUMN IF NOT EXISTS "merged_into_id" UUID,
ADD COLUMN IF NOT EXISTS "created_by_user_id" UUID,
ADD COLUMN IF NOT EXISTS "reviewed_at" TIMESTAMPTZ(6),
ADD COLUMN IF NOT EXISTS "reviewed_by_user_id" UUID;

DO $$
BEGIN
  ALTER TABLE "catalog_ingredients" ADD CONSTRAINT "chk_catalog_ingredients_status"
    CHECK ("status" IN ('active', 'pending', 'inactive', 'merged'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "catalog_ingredients" ADD CONSTRAINT "chk_catalog_ingredients_allergens_none"
    CHECK (NOT ("allergens_none" AND cardinality("allergens") > 0));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "catalog_ingredients" ADD CONSTRAINT "chk_catalog_ingredients_allergens"
    CHECK ("allergens" <@ ARRAY['gluten','crustaceans','eggs','fish','peanuts','soy','milk','nuts','celery','mustard','sesame','sulphites','lupin','molluscs']);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "catalog_ingredients" ADD CONSTRAINT "fk_catalog_ingredients_chef_profile_id"
    FOREIGN KEY ("chef_profile_id") REFERENCES "chef_profiles" ("id") ON DELETE CASCADE ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "catalog_ingredients" ADD CONSTRAINT "fk_catalog_ingredients_merged_into_id"
    FOREIGN KEY ("merged_into_id") REFERENCES "catalog_ingredients" ("id") ON DELETE SET NULL ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "catalog_ingredients" ADD CONSTRAINT "fk_catalog_ingredients_created_by_user_id"
    FOREIGN KEY ("created_by_user_id") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "catalog_ingredients" ADD CONSTRAINT "fk_catalog_ingredients_reviewed_by_user_id"
    FOREIGN KEY ("reviewed_by_user_id") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Names are unique per scope now: once in the common list, once per chef among
-- the ingredients still waiting for review.
DROP INDEX IF EXISTS "uq_catalog_ingredients_name";

CREATE UNIQUE INDEX IF NOT EXISTS "uq_catalog_ingredients_common_name"
  ON "catalog_ingredients" ("normalized_name")
  WHERE "chef_profile_id" IS NULL AND "normalized_name" IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "uq_catalog_ingredients_private_name"
  ON "catalog_ingredients" ("chef_profile_id", "normalized_name")
  WHERE "status" = 'pending';

CREATE INDEX IF NOT EXISTS "ix_catalog_ingredients_chef_profile_id" ON "catalog_ingredients" ("chef_profile_id");
CREATE INDEX IF NOT EXISTS "ix_catalog_ingredients_status" ON "catalog_ingredients" ("status");

-- `added_allergens`: allergens the chef adds by hand. `conditional_allergens`:
-- computed, those brought only by optional lines. `lock_version` is bumped on
-- every save so a stale write can be rejected.
ALTER TABLE "meals"
ADD COLUMN IF NOT EXISTS "added_allergens" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
ADD COLUMN IF NOT EXISTS "conditional_allergens" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
ADD COLUMN IF NOT EXISTS "lock_version" INTEGER NOT NULL DEFAULT 0;
