-- Service offers: whether the chef does the shopping, and what it costs.
-- Bookings: the shopping fee charged, kept apart from the prestation price.
-- Existing rows keep today's behaviour: no shopping, no fee.

-- AlterTable
ALTER TABLE "service_offers"
  ADD COLUMN "shopping_included" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "shopping_fee_cents" INTEGER NOT NULL DEFAULT 0;

-- A fee only makes sense when the chef does the shopping.
ALTER TABLE "service_offers"
  ADD CONSTRAINT "ck_service_offers_shopping_fee" CHECK (
    "shopping_fee_cents" >= 0 AND ("shopping_included" OR "shopping_fee_cents" = 0)
  );

-- AlterTable: already counted in "amount_ttc"; stored apart so the detail can show it.
ALTER TABLE "bookings"
  ADD COLUMN "shopping_fee_cents" INTEGER NOT NULL DEFAULT 0,
  ADD CONSTRAINT "ck_bookings_shopping_fee" CHECK ("shopping_fee_cents" >= 0);
