-- Booking supplements: adults beyond what the offer covers, and the extra dishes
-- the client asks for (the "Plats supp." counter). Each amount is stored apart so
-- the detail can show it, and is already counted in "amount_ttc". Existing
-- bookings had none.

-- AlterTable
ALTER TABLE "bookings"
  ADD COLUMN "extra_meals" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "extra_persons_cents" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "extra_meals_cents" INTEGER NOT NULL DEFAULT 0,
  ADD CONSTRAINT "ck_bookings_extra_meals" CHECK ("extra_meals" BETWEEN 0 AND 20),
  ADD CONSTRAINT "ck_bookings_supplements" CHECK (
    "extra_persons_cents" >= 0 AND "extra_meals_cents" >= 0
  );
