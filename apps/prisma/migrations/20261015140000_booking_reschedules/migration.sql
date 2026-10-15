-- Rescheduling a confirmed booking (in-house calendar, phase D3): one side
-- proposes a new start, the other confirms it. Nothing moves inside the last 48 h;
-- a proposal expires 48 h after it is made, or 48 h before the start.

-- CreateTable
CREATE TABLE "booking_reschedules" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "booking_id" UUID NOT NULL,
    "proposed_by_role" VARCHAR(8) NOT NULL,
    "proposed_by_user_id" UUID,
    "from_starts_at" TIMESTAMPTZ(6) NOT NULL,
    "to_starts_at" TIMESTAMPTZ(6) NOT NULL,
    "status" VARCHAR(10) NOT NULL DEFAULT 'pending',
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "decided_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "booking_reschedules_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ck_booking_reschedules_role" CHECK ("proposed_by_role" IN ('client', 'chef')),
    CONSTRAINT "ck_booking_reschedules_status" CHECK (
      "status" IN ('pending', 'accepted', 'declined', 'withdrawn', 'expired')
    )
);

-- CreateIndex
CREATE INDEX "ix_booking_reschedules_booking_created_at" ON "booking_reschedules"("booking_id", "created_at");

-- CreateIndex: the hourly expiry job.
CREATE INDEX "ix_booking_reschedules_status_expires_at" ON "booking_reschedules"("status", "expires_at");

-- One open proposal per booking. Lives only here: Prisma has no partial indexes.
CREATE UNIQUE INDEX "uq_booking_reschedules_open" ON "booking_reschedules"("booking_id") WHERE "status" = 'pending';

-- AddForeignKey
ALTER TABLE "booking_reschedules" ADD CONSTRAINT "fk_booking_reschedules_booking_id" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "booking_reschedules" ADD CONSTRAINT "fk_booking_reschedules_proposed_by_user_id" FOREIGN KEY ("proposed_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
