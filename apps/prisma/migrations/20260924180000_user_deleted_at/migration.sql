-- A deleted Clerk account whose bookings still reference its row.
--
-- Such a row cannot be deleted: bookings RESTRICT it, directly or through the chef
-- profile. It is kept with its personal data blanked, and `deleted_at` records when.
-- Nullable, so every existing row stays a live account. Additive.
ALTER TABLE "users" ADD COLUMN     "deleted_at" TIMESTAMPTZ(6);
