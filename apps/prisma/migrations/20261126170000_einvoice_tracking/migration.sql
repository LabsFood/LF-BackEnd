-- Autofactures handed to the approved e-invoicing platform (B2Brouter, before
-- 1 September 2027). Null until sent; nothing is sent while EINVOICING_PROVIDER=none.
ALTER TABLE "payout_statements"
  ADD COLUMN "einvoice_provider" VARCHAR(32),
  ADD COLUMN "einvoice_external_id" VARCHAR(128),
  ADD COLUMN "einvoice_status" VARCHAR(32),
  ADD COLUMN "einvoice_sent_at" TIMESTAMPTZ(6);

