-- Recettes lot 3 (LF-0268): a booked dish keeps the recipe version AND the allergens
-- of the moment its menu was written. `pinned_at` null: pinned before lot 3, or not
-- yet; the lazy pin of the recipe sheet and the shopping list fills both.
-- Additive and replayable: two columns, the array with a default, no table rewrite.
ALTER TABLE "booking_meals"
ADD COLUMN IF NOT EXISTS "allergens_snapshot" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
ADD COLUMN IF NOT EXISTS "pinned_at" TIMESTAMPTZ(6);
