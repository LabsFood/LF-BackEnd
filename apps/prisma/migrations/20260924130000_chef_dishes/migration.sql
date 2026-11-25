-- FLOW-02 milestone 2: the fields a batch cooker's dish carries (§3.1).
--
-- `allergens_none` is the explicit "none of the 14 regulated allergens" that
-- publication requires when `allergens` is empty. `custom_diets` and
-- `custom_allergens` hold free-text values outside the reference lists.
-- `reheating` and `storage` complete the recipe for the fiche. `published_at`
-- orders the admin review queue. Additive: every column is nullable or defaulted,
-- and existing Lab's Food meals keep their values.
ALTER TABLE "meals" ADD COLUMN     "allergens_none" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "category" VARCHAR(24),
ADD COLUMN     "cook_time" INTEGER,
ADD COLUMN     "custom_allergens" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "custom_diets" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "published_at" TIMESTAMPTZ(6),
ADD COLUMN     "reheating" JSONB,
ADD COLUMN     "storage" JSONB;

-- The declaration cannot contradict itself, whatever writes it: "none of the 14"
-- next to a listed allergen would be a false allergen label. The API refuses it
-- first; this stops two concurrent edits from combining into one. Every existing
-- row has allergens_none = false, so the constraint validates at once.
ALTER TABLE "meals" ADD CONSTRAINT "chk_meals_allergens_none"
  CHECK (NOT ("allergens_none" AND cardinality("allergens") > 0));

ALTER TABLE "meals" ADD CONSTRAINT "chk_meals_cook_time"
  CHECK ("cook_time" IS NULL OR "cook_time" >= 0);
