-- The batch cooker's agenda (in-house calendar, phase D1).
--
-- `chef_time_blocks`: time a batch cooker blocks themselves (a dentist, an
-- afternoon off). Busy for bookings; the API refuses a block over a booking.
--
-- `bookings.address_city` / `address_postal_code`: the agenda shows the city of a
-- prestation without its street. Quote-born bookings get them from their quote.

-- AlterTable
ALTER TABLE "bookings" ADD COLUMN IF NOT EXISTS "address_city" VARCHAR(120);
ALTER TABLE "bookings" ADD COLUMN IF NOT EXISTS "address_postal_code" VARCHAR(16);

-- Backfill
UPDATE "bookings" b
SET "address_city" = q."address_city",
    "address_postal_code" = q."address_postal_code"
FROM "quotes" q
WHERE q."booking_id" = b."id"
  AND b."address_city" IS NULL;

-- CreateTable
CREATE TABLE "chef_time_blocks" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "chef_profile_id" UUID NOT NULL,
    "starts_at" TIMESTAMPTZ(6) NOT NULL,
    "ends_at" TIMESTAMPTZ(6) NOT NULL,
    "reason" VARCHAR(255),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chef_time_blocks_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ck_chef_time_blocks_range" CHECK ("starts_at" < "ends_at")
);

-- CreateIndex: also serves the agenda's range reads, on its first two columns.
CREATE UNIQUE INDEX "uq_chef_time_blocks_chef_range" ON "chef_time_blocks"("chef_profile_id", "starts_at", "ends_at");

-- AddForeignKey
ALTER TABLE "chef_time_blocks" ADD CONSTRAINT "fk_chef_time_blocks_chef_profile_id" FOREIGN KEY ("chef_profile_id") REFERENCES "chef_profiles"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
