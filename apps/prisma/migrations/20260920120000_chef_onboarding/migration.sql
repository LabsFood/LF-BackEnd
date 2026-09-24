-- FLOW-01 — batch cooker candidature, KYC documents, admin validation.
-- Idempotent throughout so a partially applied migration can be re-run.

-- ------------------------------------------------- retire the legacy model
--
-- `20250522130000_spec_domain` created a `chef_applications` table and a
-- `chef_application_status` enum for the older recruitment-pipeline design
-- (birth_year, experience_years, interview_date...). Neither was ever added to
-- schema.prisma and no code reads them, but both collide by name with FLOW-01.
--
-- They are renamed aside, not dropped: renaming is reversible and cannot lose a
-- row if any environment turns out to hold real candidatures. Drop
-- `*_legacy` in a follow-up once production is confirmed empty.
--
-- Detection keys on `birth_year` / the `new` enum label, which exist only in the
-- old shape, so re-running this migration is a no-op once the rename has happened.

DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'chef_applications'
      AND column_name = 'birth_year'
  ) THEN
    ALTER TABLE "chef_applications" RENAME TO "chef_applications_legacy";
    -- Free the constraint name too, or the new table's primary key lands as
    -- `chef_applications_pkey1` and shows up as drift forever.
    ALTER TABLE "chef_applications_legacy"
      RENAME CONSTRAINT "chef_applications_pkey" TO "chef_applications_legacy_pkey";
  END IF;
END $$;

DO $$ BEGIN
  IF to_regclass('public.application_documents') IS NOT NULL
     AND to_regclass('public.application_documents_legacy') IS NULL THEN
    ALTER TABLE "application_documents" RENAME TO "application_documents_legacy";
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'chef_application_status' AND e.enumlabel = 'new'
  ) THEN
    ALTER TYPE "chef_application_status" RENAME TO "chef_application_status_legacy";
  END IF;
END $$;

-- ---------------------------------------------------------------- enums

DO $$ BEGIN
  CREATE TYPE "chef_application_status" AS ENUM ('submitted', 'changes_requested', 'approved', 'rejected');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "chef_document_status" AS ENUM ('submitted', 'reviewing', 'valid', 'rejected', 'expiring', 'expired');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "chef_document_type" AS ENUM ('identity', 'residence_permit', 'renewal_receipt', 'status_proof', 'registration', 'sap_declaration', 'rc_pro', 'haccp', 'ddpp', 'vigilance');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "work_authorization_status" AS ENUM ('eu_citizen', 'residence_permit', 'renewal_pending', 'other');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "company_legal_form" AS ENUM ('micro', 'other_company', 'not_registered');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "sap_path" AS ENUM ('type_a', 'type_b');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ------------------------------------------------- chef_profiles columns

ALTER TABLE "chef_profiles"
  ADD COLUMN IF NOT EXISTS "intervention_zones"     jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS "sap_path"               "sap_path",
  ADD COLUMN IF NOT EXISTS "sap_declaration_number" varchar(16),
  ADD COLUMN IF NOT EXISTS "auto_suspended_at"      timestamptz(6);

-- ----------------------------------------------------- chef_applications

CREATE TABLE IF NOT EXISTS "chef_applications" (
  "id"                         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "reference"                  varchar(32) NOT NULL,
  "status"                     "chef_application_status" NOT NULL DEFAULT 'submitted',

  "first_name"                 varchar(120) NOT NULL,
  "last_name"                  varchar(120) NOT NULL,
  "email"                      varchar(320) NOT NULL,
  "phone"                      varchar(32)  NOT NULL,

  "address_street"             varchar(255) NOT NULL,
  "address_line2"              varchar(255),
  "address_postcode"           varchar(5)   NOT NULL,
  "address_city"               varchar(120) NOT NULL,
  "address_country"            varchar(2)   NOT NULL DEFAULT 'FR',

  "intervention_zones"         jsonb NOT NULL,

  "work_authorization_status"  "work_authorization_status" NOT NULL,
  "work_authorization_details" text,

  "company_legal_form"         "company_legal_form" NOT NULL,
  "company_siret"              varchar(14),
  "sap_path"                   "sap_path" NOT NULL DEFAULT 'type_b',
  "sap_declaration_number"     varchar(16),

  "consent_privacy_policy"     boolean NOT NULL,
  "consent_terms"              boolean NOT NULL,
  "consent_accepted_at"        timestamptz(6) NOT NULL,

  "token_hash"                 varchar(64),
  "token_expires_at"           timestamptz(6),
  "resend_count"               integer NOT NULL DEFAULT 0,
  "resend_window_started_at"   timestamptz(6),

  "submitted_at"               timestamptz(6) NOT NULL DEFAULT now(),
  "last_activity_at"           timestamptz(6) NOT NULL DEFAULT now(),
  "decided_at"                 timestamptz(6),
  "decided_by_user_id"         uuid,
  "decision_reason"            text,
  "decision_reason_code"       varchar(64),
  "allow_reapply_after"        date,

  "approved_user_id"           uuid,
  "chef_profile_id"            uuid,

  "created_at"                 timestamptz(6) NOT NULL DEFAULT now(),
  "updated_at"                 timestamptz(6) NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "uq_chef_applications_reference"        ON "chef_applications" ("reference");
CREATE UNIQUE INDEX IF NOT EXISTS "uq_chef_applications_approved_user_id" ON "chef_applications" ("approved_user_id");
CREATE UNIQUE INDEX IF NOT EXISTS "uq_chef_applications_chef_profile_id"  ON "chef_applications" ("chef_profile_id");
CREATE        INDEX IF NOT EXISTS "ix_chef_applications_status_submitted_at" ON "chef_applications" ("status", "submitted_at");
CREATE        INDEX IF NOT EXISTS "ix_chef_applications_email"            ON "chef_applications" ("email");

-- One live candidature per address. A decided one (approved/rejected) no longer
-- blocks, which is what lets a refused candidate re-apply. Prisma cannot express
-- a partial unique index, so it lives here and here only.
CREATE UNIQUE INDEX IF NOT EXISTS "uq_chef_applications_email_pending"
  ON "chef_applications" (lower("email"))
  WHERE "status" IN ('submitted', 'changes_requested');

DO $$ BEGIN
  ALTER TABLE "chef_applications"
    ADD CONSTRAINT "fk_chef_applications_decided_by"
    FOREIGN KEY ("decided_by_user_id") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "chef_applications"
    ADD CONSTRAINT "fk_chef_applications_approved_user"
    FOREIGN KEY ("approved_user_id") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "chef_applications"
    ADD CONSTRAINT "fk_chef_applications_chef_profile"
    FOREIGN KEY ("chef_profile_id") REFERENCES "chef_profiles" ("id") ON DELETE SET NULL ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- -------------------------------------------------------- chef_documents

CREATE TABLE IF NOT EXISTS "chef_documents" (
  "id"                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "application_id"     uuid,
  "chef_profile_id"    uuid,
  "type"               "chef_document_type"   NOT NULL,
  "status"             "chef_document_status" NOT NULL DEFAULT 'submitted',
  "version"            integer NOT NULL DEFAULT 1,

  "storage_path"       varchar(512) NOT NULL,
  "file_name"          varchar(255) NOT NULL,
  "mime_type"          varchar(120) NOT NULL,
  "size_bytes"         integer NOT NULL,
  "expires_on"         date,
  "expiry_notice_days" integer,

  "submitted_at"       timestamptz(6) NOT NULL DEFAULT now(),
  "decided_at"         timestamptz(6),
  "decided_by_user_id" uuid,
  "reason"             text,
  "reason_code"        varchar(64),

  "created_at"         timestamptz(6) NOT NULL DEFAULT now(),
  "updated_at"         timestamptz(6) NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "uq_chef_documents_application_type_version"
  ON "chef_documents" ("application_id", "type", "version");
CREATE INDEX IF NOT EXISTS "ix_chef_documents_chef_profile_type_version"
  ON "chef_documents" ("chef_profile_id", "type", "version");
CREATE INDEX IF NOT EXISTS "ix_chef_documents_status_expires_on"
  ON "chef_documents" ("status", "expires_on");

DO $$ BEGIN
  ALTER TABLE "chef_documents"
    ADD CONSTRAINT "fk_chef_documents_application"
    FOREIGN KEY ("application_id") REFERENCES "chef_applications" ("id") ON DELETE CASCADE ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "chef_documents"
    ADD CONSTRAINT "fk_chef_documents_chef_profile"
    FOREIGN KEY ("chef_profile_id") REFERENCES "chef_profiles" ("id") ON DELETE CASCADE ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "chef_documents"
    ADD CONSTRAINT "fk_chef_documents_decided_by"
    FOREIGN KEY ("decided_by_user_id") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- A document belongs to a candidature, a chef dossier, or both after approval —
-- never to neither. This is what keeps the "no copy on approval" design honest.
DO $$ BEGIN
  ALTER TABLE "chef_documents"
    ADD CONSTRAINT "ck_chef_documents_owner"
    CHECK ("application_id" IS NOT NULL OR "chef_profile_id" IS NOT NULL);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ------------------------------------------------------------- audit_log

CREATE TABLE IF NOT EXISTS "audit_log" (
  "id"            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "request_id"    varchar(64),
  "actor_type"    varchar(24) NOT NULL,
  "actor_user_id" uuid,
  "action"        varchar(96) NOT NULL,
  "subject_type"  varchar(48) NOT NULL,
  "subject_id"    uuid,
  "outcome"       varchar(16) NOT NULL DEFAULT 'ok',
  "metadata"      jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_at"    timestamptz(6) NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "ix_audit_log_subject" ON "audit_log" ("subject_id", "created_at");
CREATE INDEX IF NOT EXISTS "ix_audit_log_action"  ON "audit_log" ("action", "created_at");

DO $$ BEGIN
  ALTER TABLE "audit_log"
    ADD CONSTRAINT "fk_audit_log_actor"
    FOREIGN KEY ("actor_user_id") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
