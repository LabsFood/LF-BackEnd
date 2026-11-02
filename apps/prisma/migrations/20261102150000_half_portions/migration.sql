-- Recettes lot 2, BLK-27 (decided 2026-11-02): a child counts as half a portion.
-- A booked dish defaults to the client's household, adults plus half the children,
-- so its portions can end in .5. Every existing value is kept as it is.
ALTER TABLE "booking_meals" ALTER COLUMN "portions" TYPE DOUBLE PRECISION;
