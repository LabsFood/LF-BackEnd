-- Facture A: the invoice the client receives for one card payment, in the chef's name.
--
-- Idempotent, same discipline as 20260905120000_payments_cesu_commission_debits: Prisma
-- does not wrap a migration file in a transaction, so a failure part-way through commits
-- what came before and `migrate deploy` replays the file from the top.
--
-- No backfill: payments settled before this migration get no invoice. Inventing an
-- invoice number and date for a past payment would be a falsified legal document.

-- CreateTable
CREATE TABLE IF NOT EXISTS "payment_invoices" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "payment_id" UUID NOT NULL,
    "booking_id" UUID NOT NULL,
    "client_id" UUID NOT NULL,
    "chef_profile_id" UUID NOT NULL,
    "invoice_number" VARCHAR(32) NOT NULL,
    "issued_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "amount_ttc_cents" INTEGER NOT NULL,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'EUR',
    "snapshot" JSONB NOT NULL,
    "storage_path" VARCHAR(512),
    "archived_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_invoices_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "uq_payment_invoices_payment_id" ON "payment_invoices"("payment_id");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "uq_payment_invoices_invoice_number" ON "payment_invoices"("invoice_number");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ix_payment_invoices_client_issued" ON "payment_invoices"("client_id", "issued_at");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ix_payment_invoices_chef_profile_id" ON "payment_invoices"("chef_profile_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ix_payment_invoices_booking_id" ON "payment_invoices"("booking_id");

-- AddForeignKey
DO $$
BEGIN
  ALTER TABLE "payment_invoices" ADD CONSTRAINT "fk_payment_invoices_payment_id"
    FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$
BEGIN
  ALTER TABLE "payment_invoices" ADD CONSTRAINT "fk_payment_invoices_booking_id"
    FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$
BEGIN
  ALTER TABLE "payment_invoices" ADD CONSTRAINT "fk_payment_invoices_client_id"
    FOREIGN KEY ("client_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$
BEGIN
  ALTER TABLE "payment_invoices" ADD CONSTRAINT "fk_payment_invoices_chef_profile_id"
    FOREIGN KEY ("chef_profile_id") REFERENCES "chef_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
