-- Import de recettes par IA (DAT 4.1): the sources a batch cooker sends and their
-- processing, and on each meal the import it came from. Additive and replayable.
CREATE TABLE IF NOT EXISTS "recipe_imports" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "chef_profile_id" UUID NOT NULL,
  "source_type" VARCHAR(8) NOT NULL,
  "storage_paths" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "source_text" TEXT,
  "source_url" VARCHAR(2048),
  "source_title" VARCHAR(255),
  "status" VARCHAR(12) NOT NULL DEFAULT 'pending',
  "error_code" VARCHAR(48),
  "error_message" VARCHAR(500),
  "extraction" JSONB,
  "report" JSONB NOT NULL DEFAULT '{}',
  "provider" VARCHAR(16),
  "model" VARCHAR(64),
  "cost_micro_eur" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "started_at" TIMESTAMPTZ(6),
  "finished_at" TIMESTAMPTZ(6),
  "files_purged_at" TIMESTAMPTZ(6),
  CONSTRAINT "recipe_imports_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ck_recipe_imports_source_type" CHECK ("source_type" IN ('file', 'text', 'url', 'title')),
  CONSTRAINT "ck_recipe_imports_status" CHECK ("status" IN ('pending', 'processing', 'review', 'done', 'failed'))
);
DO $$ BEGIN
  ALTER TABLE "recipe_imports" ADD CONSTRAINT "fk_recipe_imports_chef_profile_id"
    FOREIGN KEY ("chef_profile_id") REFERENCES "chef_profiles"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS "idx_recipe_imports_chef_created_at" ON "recipe_imports" ("chef_profile_id", "created_at");
CREATE INDEX IF NOT EXISTS "idx_recipe_imports_status_started_at" ON "recipe_imports" ("status", "started_at");

ALTER TABLE "meals" ADD COLUMN IF NOT EXISTS "imported_from_id" UUID;
DO $$ BEGIN
  ALTER TABLE "meals" ADD CONSTRAINT "fk_meals_imported_from_id"
    FOREIGN KEY ("imported_from_id") REFERENCES "recipe_imports"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
