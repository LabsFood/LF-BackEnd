-- Import de recettes par IA depuis la console : un admin importe pour le catalogue
-- Lab's Food, sans cuisinier. L'import garde l'admin qui l'a lancé. Additif et rejouable.
ALTER TABLE "recipe_imports" ALTER COLUMN "chef_profile_id" DROP NOT NULL;
ALTER TABLE "recipe_imports" ADD COLUMN IF NOT EXISTS "created_by_user_id" UUID;
DO $$ BEGIN
  ALTER TABLE "recipe_imports" ADD CONSTRAINT "fk_recipe_imports_created_by_user_id"
    FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "recipe_imports" ADD CONSTRAINT "ck_recipe_imports_owner"
    CHECK ("chef_profile_id" IS NOT NULL OR "created_by_user_id" IS NOT NULL) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS "idx_recipe_imports_created_by_created_at"
  ON "recipe_imports" ("created_by_user_id", "created_at");
