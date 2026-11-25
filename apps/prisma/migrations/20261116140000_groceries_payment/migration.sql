-- Recettes lot 6 (decisions of 31/10, 11/11 and 16/11): groceries paid apart by card,
-- a hold at the lock, the receipts, contests, chargebacks, and the commission credit
-- note of facture B. Additive and replayable: every object is guarded.


DO $$ BEGIN
  CREATE TYPE "commission_invoice_kind" AS ENUM ('invoice', 'credit_note');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "grocery_run_status" AS ENUM ('awaiting_card', 'card_saved', 'hold_placed', 'hold_failed', 'notice_sent', 'awaiting_client', 'confirmed', 'cancelled', 'receipts_submitted', 'captured', 'settled');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "grocery_contest_decision" AS ENUM ('upheld', 'rejected');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "grocery_dispute_fault" AS ENUM ('chef', 'client', 'platform');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "commission_invoices" ADD COLUMN IF NOT EXISTS "applied_to_invoice_id" UUID,
ADD COLUMN IF NOT EXISTS "credit_for_commission_id" UUID,
ADD COLUMN IF NOT EXISTS "credit_reason" TEXT,
ADD COLUMN IF NOT EXISTS "kind" "commission_invoice_kind" NOT NULL DEFAULT 'invoice',
ADD COLUMN IF NOT EXISTS "refunded_at" TIMESTAMPTZ(6);

CREATE TABLE IF NOT EXISTS "grocery_runs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "booking_id" UUID NOT NULL,
    "status" "grocery_run_status" NOT NULL DEFAULT 'awaiting_card',
    "budget_cents" INTEGER NOT NULL,
    "mandate_version" VARCHAR(16) NOT NULL,
    "mandate_rules" JSONB NOT NULL,
    "mandate_accepted_at" TIMESTAMPTZ(6) NOT NULL,
    "mandate_document_sha256" VARCHAR(64),
    "mandate_ip" VARCHAR(64),
    "mandate_user_agent" VARCHAR(512),
    "stripe_customer_id" VARCHAR(128),
    "stripe_setup_intent_id" VARCHAR(128),
    "stripe_payment_method_id" VARCHAR(128),
    "card_brand" VARCHAR(32),
    "card_last4" VARCHAR(4),
    "card_exp_month" INTEGER,
    "card_exp_year" INTEGER,
    "card_saved_at" TIMESTAMPTZ(6),
    "hold_payment_id" UUID,
    "hold_claimed_at" TIMESTAMPTZ(6),
    "hold_placed_at" TIMESTAMPTZ(6),
    "hold_expires_at" TIMESTAMPTZ(6),
    "hold_failed_at" TIMESTAMPTZ(6),
    "hold_failure_code" VARCHAR(64),
    "shopping_at" TIMESTAMPTZ(6),
    "cancel_deadline" TIMESTAMPTZ(6),
    "notice_sent_at" TIMESTAMPTZ(6),
    "notice_notification_id" UUID,
    "email_message_id" VARCHAR(255),
    "email_delivered_at" TIMESTAMPTZ(6),
    "email_bounced_at" TIMESTAMPTZ(6),
    "email_last_event" VARCHAR(32),
    "deadline_handled_at" TIMESTAMPTZ(6),
    "confirmed_at" TIMESTAMPTZ(6),
    "confirmed_by" VARCHAR(16),
    "cancelled_at" TIMESTAMPTZ(6),
    "cancelled_by" VARCHAR(16),
    "cancel_reason" TEXT,
    "forfait_waived_cents" INTEGER NOT NULL DEFAULT 0,
    "receipts_submitted_at" TIMESTAMPTZ(6),
    "receipts_total_cents" INTEGER,
    "contest_closes_at" TIMESTAMPTZ(6),
    "capture_due_at" TIMESTAMPTZ(6),
    "capture_claimed_at" TIMESTAMPTZ(6),
    "captured_at" TIMESTAMPTZ(6),
    "captured_cents" INTEGER,
    "released_cents" INTEGER,
    "safety_capture" BOOLEAN NOT NULL DEFAULT false,
    "capture_error" TEXT,
    "instant_payout" BOOLEAN NOT NULL DEFAULT false,
    "instant_payout_fee_cents" INTEGER,
    "instant_payout_id" VARCHAR(128),
    "instant_payout_status" VARCHAR(32),
    "settled_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "grocery_runs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "grocery_receipts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "grocery_run_id" UUID NOT NULL,
    "storage_path" VARCHAR(255) NOT NULL,
    "mime_type" VARCHAR(64) NOT NULL,
    "purchased_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "grocery_receipts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "grocery_lines" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "grocery_run_id" UUID NOT NULL,
    "receipt_id" UUID,
    "label" VARCHAR(160) NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "client_approved_at" TIMESTAMPTZ(6),
    "contested_at" TIMESTAMPTZ(6),
    "contest_reason" TEXT,
    "decision" "grocery_contest_decision",
    "decided_at" TIMESTAMPTZ(6),
    "decided_by_user_id" UUID,
    "decision_note" TEXT,
    "refunded_cents" INTEGER NOT NULL DEFAULT 0,
    "stripe_refund_id" VARCHAR(128),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "grocery_lines_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "grocery_disputes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "grocery_run_id" UUID NOT NULL,
    "payment_id" UUID NOT NULL,
    "stripe_dispute_id" VARCHAR(128) NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "reason" VARCHAR(64),
    "status" VARCHAR(16) NOT NULL DEFAULT 'open',
    "opened_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closed_at" TIMESTAMPTZ(6),
    "fault" "grocery_dispute_fault",
    "fault_declared_at" TIMESTAMPTZ(6),
    "fault_declared_by_id" UUID,
    "recovery_status" VARCHAR(16) NOT NULL DEFAULT 'none',
    "recovery_reference" VARCHAR(255),
    "recovered_at" TIMESTAMPTZ(6),
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "grocery_disputes_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "uq_grocery_runs_booking_id" ON "grocery_runs"("booking_id");

CREATE UNIQUE INDEX IF NOT EXISTS "uq_grocery_runs_hold_payment_id" ON "grocery_runs"("hold_payment_id");

CREATE INDEX IF NOT EXISTS "ix_grocery_runs_status" ON "grocery_runs"("status");

CREATE INDEX IF NOT EXISTS "ix_grocery_receipts_run_id" ON "grocery_receipts"("grocery_run_id");

CREATE INDEX IF NOT EXISTS "ix_grocery_lines_run_id" ON "grocery_lines"("grocery_run_id");

CREATE UNIQUE INDEX IF NOT EXISTS "uq_grocery_disputes_stripe_dispute_id" ON "grocery_disputes"("stripe_dispute_id");

CREATE INDEX IF NOT EXISTS "ix_grocery_disputes_run_id" ON "grocery_disputes"("grocery_run_id");

DO $$ BEGIN
  ALTER TABLE "grocery_runs" ADD CONSTRAINT "fk_grocery_runs_booking_id" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "grocery_runs" ADD CONSTRAINT "fk_grocery_runs_hold_payment_id" FOREIGN KEY ("hold_payment_id") REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "grocery_receipts" ADD CONSTRAINT "fk_grocery_receipts_run_id" FOREIGN KEY ("grocery_run_id") REFERENCES "grocery_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "grocery_lines" ADD CONSTRAINT "fk_grocery_lines_run_id" FOREIGN KEY ("grocery_run_id") REFERENCES "grocery_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "grocery_lines" ADD CONSTRAINT "fk_grocery_lines_receipt_id" FOREIGN KEY ("receipt_id") REFERENCES "grocery_receipts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "grocery_disputes" ADD CONSTRAINT "fk_grocery_disputes_run_id" FOREIGN KEY ("grocery_run_id") REFERENCES "grocery_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "grocery_disputes" ADD CONSTRAINT "fk_grocery_disputes_payment_id" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- The money rules the code relies on, held by the database too.
DO $$ BEGIN
  ALTER TABLE "grocery_runs" ADD CONSTRAINT "ck_grocery_runs_budget_positive" CHECK ("budget_cents" > 0);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "grocery_runs" ADD CONSTRAINT "ck_grocery_runs_captured_within_budget"
    CHECK ("captured_cents" IS NULL OR ("captured_cents" >= 0 AND "captured_cents" <= "budget_cents"));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "grocery_lines" ADD CONSTRAINT "ck_grocery_lines_amount_positive" CHECK ("amount_cents" > 0);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "grocery_lines" ADD CONSTRAINT "ck_grocery_lines_refund_within_amount"
    CHECK ("refunded_cents" >= 0 AND "refunded_cents" <= "amount_cents");
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
