-- « Prix net » (25/11/2026): the SAS collects CESU and the immediate advance, keeps its
-- part, and pays the batch cooker the net price by transfer.
ALTER TYPE "commission_collection_method" ADD VALUE IF NOT EXISTS 'payout_withholding';

CREATE TYPE "chef_payout_status" AS ENUM ('payable', 'paid');

CREATE TABLE "chef_payouts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "payment_id" UUID NOT NULL,
    "chef_profile_id" UUID NOT NULL,
    "method" "payment_method" NOT NULL,
    "amount_ttc_cents" INTEGER NOT NULL,
    "vat_rate_bps" INTEGER NOT NULL,
    "amount_ht_cents" INTEGER NOT NULL,
    "amount_vat_cents" INTEGER NOT NULL,
    "commission_rate_bps" INTEGER NOT NULL,
    "commission_cents" INTEGER NOT NULL,
    "cesu_fee_bps" INTEGER NOT NULL DEFAULT 0,
    "cesu_fee_cents" INTEGER NOT NULL DEFAULT 0,
    "net_cents" INTEGER NOT NULL,
    "status" "chef_payout_status" NOT NULL DEFAULT 'payable',
    "received_at" TIMESTAMPTZ(6) NOT NULL,
    "paid_at" TIMESTAMPTZ(6),
    "paid_by_user_id" UUID,
    "paid_reference" VARCHAR(140),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "chef_payouts_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ck_chef_payouts_amounts" CHECK (
        "amount_ht_cents" + "amount_vat_cents" = "amount_ttc_cents"
        AND "net_cents" = "amount_ht_cents" - "commission_cents" - "cesu_fee_cents"
        AND "net_cents" >= 0
    ),
    CONSTRAINT "ck_chef_payouts_paid" CHECK (("status" = 'paid') = ("paid_at" IS NOT NULL))
);

CREATE UNIQUE INDEX "uq_chef_payouts_payment_id" ON "chef_payouts"("payment_id");
CREATE INDEX "ix_chef_payouts_chef_status" ON "chef_payouts"("chef_profile_id", "status");
CREATE INDEX "ix_chef_payouts_status_received" ON "chef_payouts"("status", "received_at");

ALTER TABLE "chef_payouts" ADD CONSTRAINT "fk_chef_payouts_payment_id"
    FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "chef_payouts" ADD CONSTRAINT "fk_chef_payouts_chef_profile_id"
    FOREIGN KEY ("chef_profile_id") REFERENCES "chef_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "bank_credits" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "transaction_id" VARCHAR(128) NOT NULL,
    "booked_on" DATE NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "label" VARCHAR(1000) NOT NULL,
    "outcome" VARCHAR(24) NOT NULL,
    "payment_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "bank_credits_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "uq_bank_credits_transaction_id" ON "bank_credits"("transaction_id");
CREATE INDEX "ix_bank_credits_outcome" ON "bank_credits"("outcome");
