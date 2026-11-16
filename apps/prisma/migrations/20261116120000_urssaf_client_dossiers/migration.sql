-- Immediate advance, manual route through the intermediary (Unipros): a client's
-- URSSAF dossier. The data is sealed in the private KYC bucket; this table only
-- records that it exists, where, and the IBAN's last four digits.
-- Replayable.
CREATE TABLE IF NOT EXISTS "urssaf_client_dossiers" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "storage_path" VARCHAR(512) NOT NULL,
    "iban_last4" VARCHAR(4) NOT NULL,
    "filled_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "urssaf_client_dossiers_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "uq_urssaf_client_dossiers_user_id"
    ON "urssaf_client_dossiers"("user_id");

DO $$ BEGIN
  ALTER TABLE "urssaf_client_dossiers"
    ADD CONSTRAINT "fk_urssaf_client_dossiers_user_id"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
