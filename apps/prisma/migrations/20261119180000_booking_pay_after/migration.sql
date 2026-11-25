-- Direct bookings under the CGV V1 (decision of 2026-11-19): the payment method is
-- chosen and a card saved at booking, the batch cooker accepts within 48 h, the price
-- is charged after the session. Null on existing bookings: they keep the
-- pay-to-confirm model. Additive and replayable.
ALTER TABLE "bookings"
  ADD COLUMN IF NOT EXISTS "payment_method" "payment_method",
  ADD COLUMN IF NOT EXISTS "stripe_customer_id" VARCHAR(128),
  ADD COLUMN IF NOT EXISTS "stripe_payment_method_id" VARCHAR(128),
  ADD COLUMN IF NOT EXISTS "card_setup_session_id" VARCHAR(128),
  ADD COLUMN IF NOT EXISTS "card_brand" VARCHAR(32),
  ADD COLUMN IF NOT EXISTS "card_last4" VARCHAR(4),
  ADD COLUMN IF NOT EXISTS "card_saved_at" TIMESTAMPTZ(6),
  ADD COLUMN IF NOT EXISTS "requested_at" TIMESTAMPTZ(6),
  ADD COLUMN IF NOT EXISTS "accept_by" TIMESTAMPTZ(6),
  ADD COLUMN IF NOT EXISTS "accepted_at" TIMESTAMPTZ(6),
  ADD COLUMN IF NOT EXISTS "refused_at" TIMESTAMPTZ(6),
  ADD COLUMN IF NOT EXISTS "refusal_reason" VARCHAR(500),
  ADD COLUMN IF NOT EXISTS "auto_charged_at" TIMESTAMPTZ(6),
  ADD COLUMN IF NOT EXISTS "cesu_reminder_sent_at" TIMESTAMPTZ(6);

-- The end-of-session job reads accepted bookings not yet charged.
CREATE INDEX IF NOT EXISTS "ix_bookings_pay_after_due"
  ON "bookings" ("ends_at")
  WHERE "payment_method" IS NOT NULL AND "accepted_at" IS NOT NULL AND "auto_charged_at" IS NULL;
