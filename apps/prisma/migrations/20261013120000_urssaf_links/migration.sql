-- Immediate advance (URSSAF), simulated until the API access exists.
--
-- `urssaf_links` is the enrolment of one client with one batch cooker: the advance
-- exists per pair, so it cannot be a flag on the account (FLOW-03 §1.2).
--
-- `uq_payments_live_avance_booking_id` keeps one open immediate-advance request per
-- booking, as `uq_payments_live_cesu_booking_id` does for CESU: two clicks must not
-- send URSSAF the same prestation twice. Partial, so it lives here and not in the
-- Prisma schema.
-- CreateEnum
CREATE TYPE "urssaf_link_status" AS ENUM ('pending', 'active', 'refused');

-- CreateTable
CREATE TABLE "urssaf_links" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "client_id" UUID NOT NULL,
    "chef_profile_id" UUID NOT NULL,
    "status" "urssaf_link_status" NOT NULL DEFAULT 'pending',
    "refusal_reason" TEXT,
    "requested_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decided_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "urssaf_links_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ix_urssaf_links_status" ON "urssaf_links"("status");

-- CreateIndex
CREATE UNIQUE INDEX "uq_urssaf_links_client_chef" ON "urssaf_links"("client_id", "chef_profile_id");

-- AddForeignKey
ALTER TABLE "urssaf_links" ADD CONSTRAINT "fk_urssaf_links_client_id" FOREIGN KEY ("client_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "urssaf_links" ADD CONSTRAINT "fk_urssaf_links_chef_profile_id" FOREIGN KEY ("chef_profile_id") REFERENCES "chef_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- One open request per booking.
CREATE UNIQUE INDEX "uq_payments_live_avance_booking_id" ON "payments"("booking_id")
  WHERE "method" = 'avance_immediate' AND "status" = 'pending';
