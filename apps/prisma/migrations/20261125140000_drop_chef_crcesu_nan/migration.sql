-- Prefinanced CESU is paid to the platform's own CRCESU affiliation
-- (Labs Food Batchcooking SAS, `CESU_PLATFORM_NAN`): batch cookers no longer hold,
-- declare or publish a NAN.
ALTER TABLE "sap_profiles" DROP COLUMN IF EXISTS "crcesu_nan";
ALTER TABLE "sap_profiles" DROP COLUMN IF EXISTS "crcesu_affiliation_status";
