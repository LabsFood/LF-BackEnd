-- Recettes lot 2, §4.9: when the chef last confirmed a dish's allergens. Cleared
-- when an ingredient is added, removed or renamed; a dish without it cannot be
-- booked (422 ALLERGENS_UNVERIFIED).
ALTER TABLE "meals" ADD COLUMN IF NOT EXISTS "allergens_verified_at" TIMESTAMPTZ(6);

-- Decided 2026-11-02: a dish that already declares its allergens, or "none of the
-- 14", starts verified, as lot 1 treated it; the others stay unverified.
UPDATE "meals"
SET "allergens_verified_at" = now()
WHERE "allergens_verified_at" IS NULL
  AND (cardinality("allergens") > 0 OR "allergens_none");
