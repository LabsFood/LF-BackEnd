-- Reheating and storage notes belong to a dish cooked in a prestation, not to the
-- recipe (test feedback 2026-11-09). Written by the batch cooker from `cooking` on;
-- the recipe's own reheating and storage advice is untouched. Nullable: existing
-- rows have no note.
ALTER TABLE "booking_meals"
  ADD COLUMN "reheating_note" VARCHAR(500),
  ADD COLUMN "storage_note" VARCHAR(500);
