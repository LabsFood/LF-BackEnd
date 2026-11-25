-- Recettes lot 1: structured client allergies, with consent (health data).
ALTER TABLE "client_profiles"
ADD COLUMN "custom_allergies" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN "allergies_none" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "allergies_declared_at" TIMESTAMPTZ(6),
ADD COLUMN "health_consent_at" TIMESTAMPTZ(6),
ADD COLUMN "health_consent_version" VARCHAR(32);

-- `allergies` now holds the 14 regulated codes only. What clients typed before moves,
-- word for word, to `custom_allergies`: nothing is lost, and the platform still checks
-- any word naming one of the 14. `allergies_declared_at` stays null, so every client
-- answers once, with consent, before their next menu.
UPDATE "client_profiles"
SET "custom_allergies" = "allergies", "allergies" = ARRAY[]::TEXT[]
WHERE cardinality("allergies") > 0;

ALTER TABLE "client_profiles" ALTER COLUMN "custom_allergies" SET NOT NULL;

ALTER TABLE "client_profiles" ADD CONSTRAINT "chk_client_profiles_allergies_codes"
  CHECK ("allergies" <@ ARRAY['gluten', 'crustaceans', 'eggs', 'fish', 'peanuts', 'soy',
    'milk', 'nuts', 'celery', 'mustard', 'sesame', 'sulphites', 'lupin', 'molluscs']::TEXT[]);

ALTER TABLE "client_profiles" ADD CONSTRAINT "chk_client_profiles_allergies_none"
  CHECK (NOT ("allergies_none" AND
    (cardinality("allergies") > 0 OR cardinality("custom_allergies") > 0)));
