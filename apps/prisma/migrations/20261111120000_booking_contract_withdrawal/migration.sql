-- CGV V1 (in force 2026-11-21): the contract a booking is, and its withdrawal.
--
-- `concluded_at` starts the 14-day withdrawal period (CGV art. 15.1): the move to
-- `confirmed`. The consents are the three boxes of the booking flow (art. 5.1, 10.12,
-- 15.3), kept with the CGV version they were given under. All nullable: a booking
-- made before the CGV V1 has none.
ALTER TABLE "bookings"
  ADD COLUMN "concluded_at" TIMESTAMPTZ(6),
  ADD COLUMN "contract_version" VARCHAR(16),
  ADD COLUMN "cgv_accepted_at" TIMESTAMPTZ(6),
  ADD COLUMN "debours_mandate_accepted_at" TIMESTAMPTZ(6),
  ADD COLUMN "early_execution_requested_at" TIMESTAMPTZ(6),
  ADD COLUMN "contract_mail_sent_at" TIMESTAMPTZ(6),
  ADD COLUMN "withdrawn_at" TIMESTAMPTZ(6),
  ADD COLUMN "withdrawal_due_cents" INTEGER,
  ADD COLUMN "withdrawal_ack_sent_at" TIMESTAMPTZ(6);

-- Bookings already past `pending` were concluded before this column existed. The
-- moment is not recorded anywhere exact; `created_at` is close enough for data made
-- before launch. `contract_mail_sent_at` is set too, so the new contract email does
-- not go out for them.
UPDATE "bookings"
SET "concluded_at" = "created_at",
    "contract_mail_sent_at" = now()
WHERE "status" IN ('confirmed', 'shopping', 'cooking', 'delivered', 'completed', 'disputed');

-- CGV art. 3.2: the batch cooker's legal identity, shown to the client before any
-- booking. Entered by the chef; nothing blocks while it is incomplete.
ALTER TABLE "chef_profiles"
  ADD COLUMN "legal_name" VARCHAR(160),
  ADD COLUMN "legal_status" VARCHAR(32),
  ADD COLUMN "siren" VARCHAR(9),
  ADD COLUMN "business_address" VARCHAR(255),
  ADD COLUMN "vat_regime" VARCHAR(16),
  ADD COLUMN "vat_number" VARCHAR(16),
  ADD COLUMN "insurer_name" VARCHAR(120),
  ADD COLUMN "insurance_coverage" VARCHAR(255),
  ADD COLUMN "mediator_name" VARCHAR(160),
  ADD COLUMN "mediator_url" VARCHAR(255);

-- Prefill what the approved candidature already holds: the SIREN is the first nine
-- digits of the SIRET, and a micro-entreprise is the only legal form it names. The
-- address is left out on purpose: the candidature's is often the chef's home.
UPDATE "chef_profiles" AS cp
SET "siren" = left(ca."company_siret", 9),
    "legal_status" = CASE WHEN ca."company_legal_form" = 'micro' THEN 'micro_entreprise' END
FROM "chef_applications" AS ca
WHERE ca."chef_profile_id" = cp."id"
  AND ca."status" = 'approved'
  AND ca."company_siret" IS NOT NULL;
