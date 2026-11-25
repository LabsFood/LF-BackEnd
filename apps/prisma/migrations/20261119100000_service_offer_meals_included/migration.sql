-- A formule offers a fixed number of dishes (decision of 19/11). Null on existing
-- offers: they keep taking any count until the batch cooker sets one. Additive and
-- replayable.
ALTER TABLE "service_offers" ADD COLUMN IF NOT EXISTS "meals_included" INTEGER;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ck_service_offers_meals_included'
  ) THEN
    ALTER TABLE "service_offers"
      ADD CONSTRAINT "ck_service_offers_meals_included"
      CHECK ("meals_included" IS NULL OR "meals_included" BETWEEN 1 AND 20);
  END IF;
END $$;
