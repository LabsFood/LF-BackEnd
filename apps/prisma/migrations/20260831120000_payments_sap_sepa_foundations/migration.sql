-- CreateEnum
CREATE TYPE "payment_method" AS ENUM ('cb', 'avance_immediate', 'cesu');

-- CreateEnum
CREATE TYPE "payment_status" AS ENUM ('pending', 'succeeded', 'failed', 'refunded', 'partially_refunded');

-- CreateEnum
CREATE TYPE "commission_collection_method" AS ENUM ('stripe_application_fee', 'sepa_direct_debit');

-- CreateEnum
CREATE TYPE "commission_status" AS ENUM ('pending', 'collected', 'failed');

-- CreateEnum
CREATE TYPE "sap_declaration_type" AS ENUM ('type_a_nova', 'type_b_cooperative');

-- CreateEnum
CREATE TYPE "sap_external_status" AS ENUM ('not_started', 'pending', 'active');

-- CreateEnum
CREATE TYPE "sepa_mandate_status" AS ENUM ('pending', 'active', 'revoked', 'failed');

-- AlterTable
ALTER TABLE "chef_profiles" ADD COLUMN     "stripe_charges_enabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "stripe_details_submitted" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "stripe_payouts_enabled" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "payments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "booking_id" UUID NOT NULL,
    "method" "payment_method" NOT NULL DEFAULT 'cb',
    "status" "payment_status" NOT NULL DEFAULT 'pending',
    "amount_ttc" INTEGER NOT NULL,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'EUR',
    "stripe_payment_intent_id" VARCHAR(128),
    "stripe_charge_id" VARCHAR(128),
    "tax_credit_eligible_amount" INTEGER,
    "paid_at" TIMESTAMPTZ(6),
    "refunded_amount" INTEGER,
    "refunded_at" TIMESTAMPTZ(6),
    "failure_reason" TEXT,
    "metadata" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commissions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "payment_id" UUID NOT NULL,
    "chef_profile_id" UUID NOT NULL,
    "rate_bps" INTEGER NOT NULL,
    "vat_rate_bps" INTEGER NOT NULL,
    "amount_ht_cents" INTEGER NOT NULL,
    "amount_vat_cents" INTEGER NOT NULL,
    "amount_ttc_cents" INTEGER NOT NULL,
    "collection_method" "commission_collection_method" NOT NULL DEFAULT 'stripe_application_fee',
    "status" "commission_status" NOT NULL DEFAULT 'pending',
    "collected_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "commissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sap_profiles" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "chef_profile_id" UUID NOT NULL,
    "declaration_type" "sap_declaration_type" NOT NULL,
    "nova_code" VARCHAR(64),
    "urssaf_tiers_prestation_status" "sap_external_status" NOT NULL DEFAULT 'not_started',
    "cooperative_name" VARCHAR(255),
    "cooperative_membership_proof" VARCHAR(512),
    "crcesu_nan" VARCHAR(64),
    "crcesu_affiliation_status" "sap_external_status" NOT NULL DEFAULT 'not_started',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sap_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sepa_mandates" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "chef_profile_id" UUID NOT NULL,
    "stripe_customer_id" VARCHAR(128),
    "stripe_setup_intent_id" VARCHAR(128),
    "stripe_payment_method_id" VARCHAR(128),
    "stripe_mandate_id" VARCHAR(128),
    "status" "sepa_mandate_status" NOT NULL DEFAULT 'pending',
    "iban_last4" VARCHAR(4),
    "signed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sepa_mandates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "uq_payments_stripe_payment_intent_id" ON "payments"("stripe_payment_intent_id");

-- CreateIndex
CREATE INDEX "ix_payments_booking_id" ON "payments"("booking_id");

-- CreateIndex
CREATE INDEX "ix_payments_status" ON "payments"("status");

-- CreateIndex
CREATE UNIQUE INDEX "uq_commissions_payment_id" ON "commissions"("payment_id");

-- CreateIndex
CREATE INDEX "ix_commissions_chef_profile_id" ON "commissions"("chef_profile_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_sap_profiles_chef_profile_id" ON "sap_profiles"("chef_profile_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_sepa_mandates_chef_profile_id" ON "sepa_mandates"("chef_profile_id");

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "fk_payments_booking_id" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commissions" ADD CONSTRAINT "fk_commissions_payment_id" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commissions" ADD CONSTRAINT "fk_commissions_chef_profile_id" FOREIGN KEY ("chef_profile_id") REFERENCES "chef_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sap_profiles" ADD CONSTRAINT "fk_sap_profiles_chef_profile_id" FOREIGN KEY ("chef_profile_id") REFERENCES "chef_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sepa_mandates" ADD CONSTRAINT "fk_sepa_mandates_chef_profile_id" FOREIGN KEY ("chef_profile_id") REFERENCES "chef_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
