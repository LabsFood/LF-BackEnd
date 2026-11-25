-- Bookings by audience (/me, /chef, /admin): what the batch cooker's prestation
-- screen needs, and the e-CESU proof of payment.
--
-- `shopping`, `cooking` and `delivered` are not added here: they have been on
-- `booking_status` since 20250522130000_spec_domain.
--
-- `ck_cesu_settlements_ecesu_proof` is NOT VALID on purpose: it holds every new
-- e-CESU declaration to its proof without failing on older rows declared before
-- the proof existed. Prisma cannot express a CHECK, so it lives only here.

-- AlterTable
ALTER TABLE "bookings" ADD COLUMN IF NOT EXISTS "arrived_at" TIMESTAMPTZ(6);

-- AlterTable
ALTER TABLE "cesu_settlements" ADD COLUMN IF NOT EXISTS "client_proof_path" VARCHAR(255),
ADD COLUMN IF NOT EXISTS "client_proof_uploaded_at" TIMESTAMPTZ(6);

ALTER TABLE "cesu_settlements" ADD CONSTRAINT "ck_cesu_settlements_ecesu_proof"
  CHECK ("medium" <> 'ecesu' OR "client_proof_path" IS NOT NULL) NOT VALID;

-- CreateTable
CREATE TABLE "booking_photos" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "booking_id" UUID NOT NULL,
    "url" VARCHAR(512) NOT NULL,
    "caption" VARCHAR(160),
    "taken_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "booking_photos_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ix_booking_photos_booking_taken_at" ON "booking_photos"("booking_id", "taken_at");

-- AddForeignKey
ALTER TABLE "booking_photos" ADD CONSTRAINT "fk_booking_photos_booking_id" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
