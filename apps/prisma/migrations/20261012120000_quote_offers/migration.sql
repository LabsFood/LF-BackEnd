-- Custom requests: the batch cooker answers with an offer (BLK-10).
--
-- A request (`quotes`) now says when and where, who has it, and which prestation
-- it became. What a batch cooker proposes is a row of `quote_offers`: the net they
-- want, and the client price computed once with the commission of that day.
-- `platform_settings` holds that commission, so an admin changes it without a
-- deploy. Additive: every new column is nullable or defaulted.
-- CreateEnum
CREATE TYPE "quote_offer_status" AS ENUM ('sent', 'viewed', 'accepted', 'declined', 'expired', 'withdrawn');

-- AlterEnum
ALTER TYPE "quote_status" ADD VALUE IF NOT EXISTS 'chef_declined';
ALTER TYPE "quote_status" ADD VALUE IF NOT EXISTS 'cancelled';

-- AlterTable
ALTER TABLE "quotes" ADD COLUMN     "address_city" VARCHAR(120),
ADD COLUMN     "address_line" VARCHAR(255),
ADD COLUMN     "address_postal_code" VARCHAR(16),
ADD COLUMN     "allergies" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "booking_id" UUID,
ADD COLUMN     "budget_cents" INTEGER,
ADD COLUMN     "chef_decline_reason" TEXT,
ADD COLUMN     "chef_declined_at" TIMESTAMPTZ(6),
ADD COLUMN     "desired_date" DATE,
ADD COLUMN     "occasion" VARCHAR(160),
ADD COLUMN     "time_slot" VARCHAR(16);

-- CreateTable
CREATE TABLE "quote_offers" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "quote_id" UUID NOT NULL,
    "chef_profile_id" UUID NOT NULL,
    "net_cents" INTEGER NOT NULL,
    "commission_bps" INTEGER NOT NULL,
    "client_price_cents" INTEGER NOT NULL,
    "after_tax_credit_cents" INTEGER NOT NULL,
    "proposed_date" DATE,
    "proposed_time_slot" VARCHAR(16),
    "conditions" TEXT,
    "valid_until" TIMESTAMPTZ(6) NOT NULL,
    "status" "quote_offer_status" NOT NULL DEFAULT 'sent',
    "viewed_at" TIMESTAMPTZ(6),
    "decided_at" TIMESTAMPTZ(6),
    "decline_reason" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "quote_offers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_settings" (
    "key" VARCHAR(64) NOT NULL,
    "value" JSONB NOT NULL,
    "updated_by_user_id" UUID,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "platform_settings_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE INDEX "ix_quote_offers_quote_created_at" ON "quote_offers"("quote_id", "created_at");

-- CreateIndex
CREATE INDEX "ix_quote_offers_status_valid_until" ON "quote_offers"("status", "valid_until");

-- CreateIndex
CREATE UNIQUE INDEX "uq_quotes_booking_id" ON "quotes"("booking_id");

-- CreateIndex
CREATE INDEX "ix_quotes_assigned_chef_status" ON "quotes"("assigned_chef_user_id", "status");

-- AddForeignKey
ALTER TABLE "quotes" ADD CONSTRAINT "fk_quotes_booking_id" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "quote_offers" ADD CONSTRAINT "fk_quote_offers_quote_id" FOREIGN KEY ("quote_id") REFERENCES "quotes"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "quote_offers" ADD CONSTRAINT "fk_quote_offers_chef_profile_id" FOREIGN KEY ("chef_profile_id") REFERENCES "chef_profiles"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- The slots a request or an offer can name.
ALTER TABLE "quotes" ADD CONSTRAINT "chk_quotes_time_slot" CHECK ("time_slot" IS NULL OR "time_slot" IN ('morning', 'afternoon', 'evening'));
ALTER TABLE "quote_offers" ADD CONSTRAINT "chk_quote_offers_time_slot" CHECK ("proposed_time_slot" IS NULL OR "proposed_time_slot" IN ('morning', 'afternoon', 'evening'));

-- Money that makes sense, whatever writes it: a positive net, a client price at
-- least as high, a rate between 0 and 100 %.
ALTER TABLE "quote_offers" ADD CONSTRAINT "chk_quote_offers_amounts" CHECK ("net_cents" > 0 AND "client_price_cents" >= "net_cents" AND "after_tax_credit_cents" >= 0 AND "after_tax_credit_cents" <= "client_price_cents" AND "commission_bps" >= 0 AND "commission_bps" < 10000);

-- One offer awaiting the client's answer per request. Two batch cookers, or two
-- clicks, cannot leave the client with two prices to choose from.
CREATE UNIQUE INDEX "uq_quote_offers_one_active" ON "quote_offers"("quote_id") WHERE "status" IN ('sent', 'viewed');

-- The commission the platform starts with: 15 %, in basis points.
INSERT INTO "platform_settings" ("key", "value") VALUES ('commission_bps', '1500'::jsonb) ON CONFLICT ("key") DO NOTHING;
