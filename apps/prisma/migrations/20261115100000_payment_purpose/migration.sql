-- Recettes lot 6, groundwork: a payment is for the service (the prestation, with the
-- forfait courses and the supplements) or for the groceries themselves (`courses`:
-- off the invoice, no commission, no tax credit). Every existing payment is a
-- service payment. Nothing creates a `courses` payment yet.
-- Replayable.
DO $$ BEGIN
  CREATE TYPE "payment_purpose" AS ENUM ('service', 'courses');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "payments"
ADD COLUMN IF NOT EXISTS "purpose" "payment_purpose" NOT NULL DEFAULT 'service';

-- "One live CESU declaration per booking" guards the service only: CESU never pays
-- groceries. Same name, narrower predicate; rebuilt in one transaction with the
-- migration, so the guard is never absent.
DROP INDEX IF EXISTS "uq_payments_live_cesu_booking_id";
CREATE UNIQUE INDEX IF NOT EXISTS "uq_payments_live_cesu_booking_id"
    ON "payments"("booking_id")
    WHERE "method" = 'cesu' AND "status" <> 'failed' AND "purpose" = 'service';
