-- Prefinanced CESU (e-CESU first) + the SEPA commission-debit engine.
--
-- Idempotent throughout, same discipline as 20260831120000_payments_sap_sepa_foundations:
-- Prisma does not wrap a migration file in a transaction, so a failure part-way through
-- commits everything before it and `migrate deploy` replays the file from the top. Every
-- statement here therefore has to converge on a replay rather than trip over the debris
-- of the previous run.

-- CreateEnum
DO $$
BEGIN
  CREATE TYPE "cesu_medium" AS ENUM ('ecesu', 'cesu_paper');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- CreateEnum
DO $$
BEGIN
  CREATE TYPE "cesu_issuer" AS ENUM ('pluxee', 'edenred', 'up', 'bimpli', 'domiserve', 'other');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- CreateEnum
DO $$
BEGIN
  CREATE TYPE "cesu_settlement_status" AS ENUM ('declared', 'confirmed', 'rejected');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- CreateEnum
DO $$
BEGIN
  CREATE TYPE "commission_invoice_status" AS ENUM ('issued', 'settled', 'written_off');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- CreateEnum
DO $$
BEGIN
  CREATE TYPE "commission_debit_status" AS ENUM ('pending', 'processing', 'succeeded', 'failed', 'canceled', 'reversed');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AlterEnum
-- Placement is explicit so the stored order reads as the actual flow:
-- pending -> invoiced (billed on a facture B) -> processing (debit in flight) -> collected,
-- with failed and reversed (SEPA CORE clawback) as the exit states.
ALTER TYPE "commission_status" ADD VALUE IF NOT EXISTS 'invoiced' AFTER 'pending';
ALTER TYPE "commission_status" ADD VALUE IF NOT EXISTS 'processing' AFTER 'invoiced';
ALTER TYPE "commission_status" ADD VALUE IF NOT EXISTS 'reversed' AFTER 'failed';

-- AlterTable
ALTER TABLE "sap_profiles"
    ADD COLUMN IF NOT EXISTS "accepts_cesu" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
-- "basis_amount_cents" starts nullable so existing rows survive, is backfilled from the
-- payment it was computed on, and only then becomes NOT NULL.
ALTER TABLE "commissions"
    ADD COLUMN IF NOT EXISTS "basis_amount_cents" INTEGER,
    ADD COLUMN IF NOT EXISTS "commission_invoice_id" UUID;

UPDATE "commissions" c
SET "basis_amount_cents" = p."amount_ttc"
FROM "payments" p
WHERE p."id" = c."payment_id"
  AND c."basis_amount_cents" IS NULL;

-- Anything the join above could not reach has no recoverable base; deriving it from the
-- stored rate would fabricate the very number this column exists to make auditable.
UPDATE "commissions" SET "basis_amount_cents" = 0 WHERE "basis_amount_cents" IS NULL;

ALTER TABLE "commissions" ALTER COLUMN "basis_amount_cents" SET NOT NULL;

-- CreateTable
CREATE TABLE IF NOT EXISTS "cesu_settlements" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "payment_id" UUID NOT NULL,
    "medium" "cesu_medium" NOT NULL,
    "issuer" "cesu_issuer",
    "status" "cesu_settlement_status" NOT NULL DEFAULT 'declared',
    "client_proof_ref" VARCHAR(255),
    "confirmed_at" TIMESTAMPTZ(6),
    "rejection_reason" TEXT,
    "confirmed_by_user_id" UUID,
    "admin_override" BOOLEAN NOT NULL DEFAULT false,
    "admin_proof_ref" VARCHAR(255),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cesu_settlements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "commission_invoices" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "chef_profile_id" UUID NOT NULL,
    "invoice_number" VARCHAR(32) NOT NULL,
    "issued_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "amount_ht_cents" INTEGER NOT NULL,
    "amount_vat_cents" INTEGER NOT NULL,
    "amount_ttc_cents" INTEGER NOT NULL,
    "rate_bps" INTEGER NOT NULL,
    "vat_rate_bps" INTEGER NOT NULL,
    "payment_method" "payment_method" NOT NULL,
    "collection_method" "commission_collection_method" NOT NULL,
    "status" "commission_invoice_status" NOT NULL DEFAULT 'issued',
    "period_start" TIMESTAMPTZ(6),
    "period_end" TIMESTAMPTZ(6),
    -- Filled by the invoicing workstream (PDF rendering + 10-year S3 retention).
    "pdf_object_key" VARCHAR(512),
    "s3_archived_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "commission_invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "commission_debits" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "commission_invoice_id" UUID NOT NULL,
    "stripe_payment_intent_id" VARCHAR(128),
    "amount_ttc_cents" INTEGER NOT NULL,
    "status" "commission_debit_status" NOT NULL DEFAULT 'pending',
    "attempt_number" INTEGER NOT NULL DEFAULT 1,
    "failure_reason" TEXT,
    "initiated_at" TIMESTAMPTZ(6),
    "settled_at" TIMESTAMPTZ(6),
    "clawback_window_ends_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "commission_debits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "stripe_event_logs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "event_id" VARCHAR(128) NOT NULL,
    "type" VARCHAR(128) NOT NULL,
    "received_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    -- The de-duplication guard reads THIS column, not the row's existence: a handler
    -- that threw has already inserted its row, and an existence check would mistake
    -- Stripe's retry for a duplicate and lose the event permanently.
    "processed_at" TIMESTAMPTZ(6),
    "error" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stripe_event_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ix_commissions_commission_invoice_id" ON "commissions"("commission_invoice_id");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "uq_cesu_settlements_payment_id" ON "cesu_settlements"("payment_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ix_cesu_settlements_status" ON "cesu_settlements"("status");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "uq_commission_invoices_invoice_number" ON "commission_invoices"("invoice_number");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ix_commission_invoices_chef_profile_id" ON "commission_invoices"("chef_profile_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ix_commission_invoices_status" ON "commission_invoices"("status");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "uq_commission_debits_stripe_payment_intent_id" ON "commission_debits"("stripe_payment_intent_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ix_commission_debits_commission_invoice_id" ON "commission_debits"("commission_invoice_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ix_commission_debits_status" ON "commission_debits"("status");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "uq_stripe_event_logs_event_id" ON "stripe_event_logs"("event_id");

-- CreateIndex
-- Concurrency guard for CESU declarations: two simultaneous `POST /payments/cesu` calls
-- on one booking would both pass the "amount left to cover" check and double-declare.
-- Partial, so retrying after a rejection stays possible and card attempts are untouched.
-- Prisma cannot express a partial unique index — this lives only here.
CREATE UNIQUE INDEX IF NOT EXISTS "uq_payments_live_cesu_booking_id"
    ON "payments"("booking_id")
    WHERE "method" = 'cesu' AND "status" <> 'failed';

-- AddForeignKey
DO $$
BEGIN
  ALTER TABLE "commissions" ADD CONSTRAINT "fk_commissions_commission_invoice_id" FOREIGN KEY ("commission_invoice_id") REFERENCES "commission_invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$
BEGIN
  ALTER TABLE "cesu_settlements" ADD CONSTRAINT "fk_cesu_settlements_payment_id" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$
BEGIN
  ALTER TABLE "cesu_settlements" ADD CONSTRAINT "fk_cesu_settlements_confirmed_by_user_id" FOREIGN KEY ("confirmed_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$
BEGIN
  ALTER TABLE "commission_invoices" ADD CONSTRAINT "fk_commission_invoices_chef_profile_id" FOREIGN KEY ("chef_profile_id") REFERENCES "chef_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$
BEGIN
  ALTER TABLE "commission_debits" ADD CONSTRAINT "fk_commission_debits_commission_invoice_id" FOREIGN KEY ("commission_invoice_id") REFERENCES "commission_invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
