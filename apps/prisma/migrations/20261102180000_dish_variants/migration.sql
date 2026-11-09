-- Recettes lot 2, §5.4: a dish copied from another keeps the link ("variante
-- de"). Separate from source_meal_id, the adoption of a Lab's Food suggestion,
-- whose unique (chef, source) index would allow a single copy.
ALTER TABLE "meals" ADD COLUMN IF NOT EXISTS "variant_of_id" UUID;
CREATE INDEX IF NOT EXISTS "ix_meals_variant_of_id" ON "meals" ("variant_of_id");

DO $$
BEGIN
  ALTER TABLE "meals" ADD CONSTRAINT "fk_meals_variant_of_id"
    FOREIGN KEY ("variant_of_id") REFERENCES "meals"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
