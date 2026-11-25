-- Recettes lot 4 (LF-0284, LF-0285): the « Courses faites » step and the in-app
-- reminders of the shopping list. One timestamp per reminder, claimed by UPDATE so
-- it goes out once, whatever the number of instances.
-- Additive and replayable: nullable columns, no default, no table rewrite.
ALTER TABLE "bookings"
ADD COLUMN IF NOT EXISTS "groceries_validated_at" TIMESTAMPTZ(6),
ADD COLUMN IF NOT EXISTS "groceries_amount_cents" INTEGER,
ADD COLUMN IF NOT EXISTS "list_reminder_chef_at" TIMESTAMPTZ(6),
ADD COLUMN IF NOT EXISTS "list_reminder_client_at" TIMESTAMPTZ(6),
ADD COLUMN IF NOT EXISTS "list_frozen_notified_at" TIMESTAMPTZ(6),
ADD COLUMN IF NOT EXISTS "groceries_reminder_at" TIMESTAMPTZ(6);

DO $$ BEGIN
  ALTER TABLE "bookings" ADD CONSTRAINT "chk_bookings_groceries_amount"
    CHECK ("groceries_amount_cents" IS NULL OR "groceries_amount_cents" >= 0);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
