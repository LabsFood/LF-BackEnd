-- Payments / SAP / SEPA foundations.
--
-- Every statement in this file is idempotent. Prisma does not wrap a migration file in a
-- transaction, so a failure part-way through commits everything before it and leaves the database
-- in a partial state that `migrate deploy` replays from the top on the next attempt. This migration
-- has already failed twice that way (first on "payment_status", then on "payment_method", which the
-- first attempt had committed). Guarding every statement makes a replay converge instead of failing
-- on the debris of the previous run — same approach as 20260524173000_provider_role_to_chef.
--
-- Two objects this migration touches already exist from 20250522130000_spec_domain and are altered
-- in place rather than created: the "payment_status" enum and the "payments" table.

-- CreateEnum
DO $$
BEGIN
  CREATE TYPE "payment_method" AS ENUM ('cb', 'avance_immediate', 'cesu');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AlterEnum
-- "payment_status" already exists from 20250522130000_spec_domain ('pending', 'paid', 'refunded').
-- Only the missing values are added; 'pending', 'paid' and 'refunded' are reused as-is.
-- Placement is explicit so the stored order matches the PaymentStatus enum in schema.prisma and
-- reads as the actual flow: pending -> succeeded (Stripe OK) -> paid (invoiceable), with
-- failed / refunded / partially_refunded as the exit states.
ALTER TYPE "payment_status" ADD VALUE IF NOT EXISTS 'succeeded' AFTER 'pending';
ALTER TYPE "payment_status" ADD VALUE IF NOT EXISTS 'failed' AFTER 'paid';
ALTER TYPE "payment_status" ADD VALUE IF NOT EXISTS 'partially_refunded' AFTER 'refunded';

-- CreateEnum
DO $$
BEGIN
  CREATE TYPE "commission_collection_method" AS ENUM ('stripe_application_fee', 'sepa_direct_debit');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- CreateEnum
DO $$
BEGIN
  CREATE TYPE "commission_status" AS ENUM ('pending', 'collected', 'failed');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- CreateEnum
DO $$
BEGIN
  CREATE TYPE "sap_declaration_type" AS ENUM ('type_a_nova', 'type_b_cooperative');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- CreateEnum
DO $$
BEGIN
  CREATE TYPE "sap_external_status" AS ENUM ('not_started', 'pending', 'active');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- CreateEnum
DO $$
BEGIN
  CREATE TYPE "sepa_mandate_status" AS ENUM ('pending', 'active', 'revoked', 'failed');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AlterTable
ALTER TABLE "chef_profiles"
    ADD COLUMN IF NOT EXISTS "stripe_charges_enabled" BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS "stripe_details_submitted" BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS "stripe_payouts_enabled" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
-- "payments" already exists from 20250522130000_spec_domain, in a different shape:
--   (id, stripe_payment_intent_id NOT NULL, amount, status, user_id, created_at, updated_at)
-- It is transformed in place rather than dropped and recreated, so existing rows and their ids
-- survive and the "bookings"."payment_id" FK stays valid for the duration of the backfill below.
-- Every new column starts nullable; NOT NULL is enforced only once the data is in place.
ALTER TABLE "payments"
    ADD COLUMN IF NOT EXISTS "booking_id" UUID,
    ADD COLUMN IF NOT EXISTS "method" "payment_method" NOT NULL DEFAULT 'cb',
    ADD COLUMN IF NOT EXISTS "currency" VARCHAR(3) NOT NULL DEFAULT 'EUR',
    ADD COLUMN IF NOT EXISTS "stripe_charge_id" VARCHAR(128),
    ADD COLUMN IF NOT EXISTS "tax_credit_eligible_amount" INTEGER,
    ADD COLUMN IF NOT EXISTS "paid_at" TIMESTAMPTZ(6),
    ADD COLUMN IF NOT EXISTS "refunded_amount" INTEGER,
    ADD COLUMN IF NOT EXISTS "refunded_at" TIMESTAMPTZ(6),
    ADD COLUMN IF NOT EXISTS "failure_reason" TEXT,
    ADD COLUMN IF NOT EXISTS "metadata" JSONB;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'payments' AND column_name = 'amount'
  ) THEN
    ALTER TABLE "payments" RENAME COLUMN "amount" TO "amount_ttc";
  END IF;
END $$;

-- Backfill "booking_id" by inverting the old 1:1 link "bookings"."payment_id" -> "payments"."id".
-- The new model is the other way round (a booking carries several payment attempts, so a failed CB
-- attempt can be retried with a fresh PaymentIntent). Guarded on the source column still being
-- present, because a replay may have already dropped it further down.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'bookings' AND column_name = 'payment_id'
  ) THEN
    UPDATE "payments" p
    SET "booking_id" = b."id"
    FROM "bookings" b
    WHERE b."payment_id" = p."id"
      AND p."booking_id" IS NULL;
  END IF;
END $$;

-- Fallback for rows the old FK never captured: match on the Stripe PaymentIntent that
-- 20250522120000_init put on "bookings". That column has no unique constraint, so collapse it to
-- one booking per intent first — otherwise a single payment could match several bookings.
UPDATE "payments" p
SET "booking_id" = b."id"
FROM (
    SELECT DISTINCT ON ("stripe_payment_intent_id") "id", "stripe_payment_intent_id"
    FROM "bookings"
    WHERE "stripe_payment_intent_id" IS NOT NULL
    ORDER BY "stripe_payment_intent_id", "created_at"
) b
WHERE p."booking_id" IS NULL
  AND b."stripe_payment_intent_id" = p."stripe_payment_intent_id";

-- Anything still unattached belongs to no booking and cannot satisfy "booking_id" NOT NULL.
DELETE FROM "payments" WHERE "booking_id" IS NULL;

ALTER TABLE "payments" ALTER COLUMN "booking_id" SET NOT NULL;

-- A payment row now exists before its PaymentIntent is created, so the intent id starts null.
ALTER TABLE "payments" ALTER COLUMN "stripe_payment_intent_id" DROP NOT NULL;

-- The payer is reachable through "bookings"."client_id"; the direct link is redundant.
ALTER TABLE "payments" DROP CONSTRAINT IF EXISTS "payments_user_id_fkey";
ALTER TABLE "payments" DROP COLUMN IF EXISTS "user_id";

-- Same index, under the name schema.prisma expects — renaming avoids a pointless rebuild.
ALTER INDEX IF EXISTS "payments_stripe_payment_intent_id_key"
    RENAME TO "uq_payments_stripe_payment_intent_id";

-- AlterTable
-- "bookings"."payment_id" is superseded by "payments"."booking_id". Dropped only now, after the
-- backfill above has consumed it.
ALTER TABLE "bookings" DROP CONSTRAINT IF EXISTS "bookings_payment_id_fkey";
DROP INDEX IF EXISTS "bookings_payment_id_key";
ALTER TABLE "bookings" DROP COLUMN IF EXISTS "payment_id";

-- CreateTable
CREATE TABLE IF NOT EXISTS "commissions" (
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
CREATE TABLE IF NOT EXISTS "sap_profiles" (
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
CREATE TABLE IF NOT EXISTS "sepa_mandates" (
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
-- "uq_payments_stripe_payment_intent_id" is not created here: it is the pre-existing unique index
-- from 20250522130000_spec_domain, renamed above.
CREATE INDEX IF NOT EXISTS "ix_payments_booking_id" ON "payments"("booking_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ix_payments_status" ON "payments"("status");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "uq_commissions_payment_id" ON "commissions"("payment_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ix_commissions_chef_profile_id" ON "commissions"("chef_profile_id");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "uq_sap_profiles_chef_profile_id" ON "sap_profiles"("chef_profile_id");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "uq_sepa_mandates_chef_profile_id" ON "sepa_mandates"("chef_profile_id");

-- AddForeignKey
DO $$
BEGIN
  ALTER TABLE "payments" ADD CONSTRAINT "fk_payments_booking_id" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$
BEGIN
  ALTER TABLE "commissions" ADD CONSTRAINT "fk_commissions_payment_id" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$
BEGIN
  ALTER TABLE "commissions" ADD CONSTRAINT "fk_commissions_chef_profile_id" FOREIGN KEY ("chef_profile_id") REFERENCES "chef_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$
BEGIN
  ALTER TABLE "sap_profiles" ADD CONSTRAINT "fk_sap_profiles_chef_profile_id" FOREIGN KEY ("chef_profile_id") REFERENCES "chef_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$
BEGIN
  ALTER TABLE "sepa_mandates" ADD CONSTRAINT "fk_sepa_mandates_chef_profile_id" FOREIGN KEY ("chef_profile_id") REFERENCES "chef_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
