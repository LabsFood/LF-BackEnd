-- Recettes lot 2: the equipment a recipe needs, as free text. Optional, never
-- checked. The new ingredient fields (link, toVerify, fixedQuantity) live in the
-- ingredients JSON and need no column.
ALTER TABLE "meals" ADD COLUMN IF NOT EXISTS "equipment" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
