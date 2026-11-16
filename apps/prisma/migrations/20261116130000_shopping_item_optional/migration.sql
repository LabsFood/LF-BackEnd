-- Recettes, decision of 16/11: a shopping line every recipe marks optional keeps
-- its place on the list, with a « facultatif » badge. Additive and replayable.
ALTER TABLE "shopping_items" ADD COLUMN IF NOT EXISTS "optional" BOOLEAN NOT NULL DEFAULT false;
