-- Keep existing provider_id columns for backward compatibility in booking flow.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'user_role' AND e.enumlabel = 'provider'
  ) THEN
    ALTER TYPE "user_role" RENAME VALUE 'provider' TO 'chef';
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('public.provider_profiles') IS NOT NULL
     AND to_regclass('public.chef_profiles') IS NULL THEN
    ALTER TABLE "provider_profiles" RENAME TO "chef_profiles";
  END IF;
END $$;

ALTER INDEX IF EXISTS "provider_profiles_pkey" RENAME TO "chef_profiles_pkey";
ALTER INDEX IF EXISTS "provider_profiles_user_id_key" RENAME TO "chef_profiles_user_id_key";
ALTER INDEX IF EXISTS "uq_provider_profiles_user_id" RENAME TO "uq_chef_profiles_user_id";

DO $$
BEGIN
  IF to_regclass('public.chef_profiles') IS NULL THEN
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_constraint c
    JOIN pg_class t ON c.conrelid = t.oid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public'
      AND t.relname = 'chef_profiles'
      AND c.conname = 'provider_profiles_user_id_fkey'
  ) AND NOT EXISTS (
    SELECT 1
    FROM pg_constraint c
    JOIN pg_class t ON c.conrelid = t.oid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public'
      AND t.relname = 'chef_profiles'
      AND c.conname = 'chef_profiles_user_id_fkey'
  ) THEN
    ALTER TABLE "chef_profiles"
      RENAME CONSTRAINT "provider_profiles_user_id_fkey" TO "chef_profiles_user_id_fkey";
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_constraint c
    JOIN pg_class t ON c.conrelid = t.oid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public'
      AND t.relname = 'chef_profiles'
      AND c.conname = 'fk_provider_profiles_user_id'
  ) AND NOT EXISTS (
    SELECT 1
    FROM pg_constraint c
    JOIN pg_class t ON c.conrelid = t.oid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public'
      AND t.relname = 'chef_profiles'
      AND c.conname = 'fk_chef_profiles_user_id'
  ) THEN
    ALTER TABLE "chef_profiles"
      RENAME CONSTRAINT "fk_provider_profiles_user_id" TO "fk_chef_profiles_user_id";
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_constraint c
    JOIN pg_class t ON c.conrelid = t.oid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public'
      AND t.relname = 'chef_profiles'
      AND c.conname = 'chef_profiles_user_id_fkey'
  ) AND NOT EXISTS (
    SELECT 1
    FROM pg_constraint c
    JOIN pg_class t ON c.conrelid = t.oid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public'
      AND t.relname = 'chef_profiles'
      AND c.conname = 'fk_chef_profiles_user_id'
  ) THEN
    ALTER TABLE "chef_profiles"
      RENAME CONSTRAINT "chef_profiles_user_id_fkey" TO "fk_chef_profiles_user_id";
  END IF;
END $$;

ALTER TABLE IF EXISTS "service_offers" DROP CONSTRAINT IF EXISTS "service_offers_provider_id_fkey";
ALTER TABLE IF EXISTS "service_offers" DROP CONSTRAINT IF EXISTS "fk_service_offers_provider_id";

DO $$
BEGIN
  IF to_regclass('public.service_offers') IS NULL
     OR to_regclass('public.chef_profiles') IS NULL THEN
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint c
    JOIN pg_class t ON c.conrelid = t.oid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public'
      AND t.relname = 'service_offers'
      AND c.conname = 'fk_service_offers_chef_profile_id'
  ) THEN
    ALTER TABLE "service_offers"
      ADD CONSTRAINT "fk_service_offers_chef_profile_id"
      FOREIGN KEY ("provider_id") REFERENCES "chef_profiles"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

ALTER INDEX IF EXISTS "ix_service_offers_provider_id" RENAME TO "ix_service_offers_chef_profile_id";

ALTER TABLE IF EXISTS "availability_slots" DROP CONSTRAINT IF EXISTS "availability_slots_provider_id_fkey";
ALTER TABLE IF EXISTS "availability_slots" DROP CONSTRAINT IF EXISTS "fk_availability_slots_provider_id";

DO $$
BEGIN
  IF to_regclass('public.availability_slots') IS NULL
     OR to_regclass('public.chef_profiles') IS NULL THEN
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint c
    JOIN pg_class t ON c.conrelid = t.oid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public'
      AND t.relname = 'availability_slots'
      AND c.conname = 'fk_availability_slots_chef_profile_id'
  ) THEN
    ALTER TABLE "availability_slots"
      ADD CONSTRAINT "fk_availability_slots_chef_profile_id"
      FOREIGN KEY ("provider_id") REFERENCES "chef_profiles"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

ALTER INDEX IF EXISTS "ix_availability_slots_provider_id"
  RENAME TO "ix_availability_slots_chef_profile_id";

ALTER TABLE IF EXISTS "bookings" DROP CONSTRAINT IF EXISTS "bookings_provider_id_fkey";
ALTER TABLE IF EXISTS "bookings" DROP CONSTRAINT IF EXISTS "fk_bookings_provider_id";

DO $$
BEGIN
  IF to_regclass('public.bookings') IS NULL
     OR to_regclass('public.chef_profiles') IS NULL THEN
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint c
    JOIN pg_class t ON c.conrelid = t.oid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public'
      AND t.relname = 'bookings'
      AND c.conname = 'fk_bookings_chef_profile_id'
  ) THEN
    ALTER TABLE "bookings"
      ADD CONSTRAINT "fk_bookings_chef_profile_id"
      FOREIGN KEY ("provider_id") REFERENCES "chef_profiles"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

ALTER INDEX IF EXISTS "ix_bookings_provider_id" RENAME TO "ix_bookings_chef_profile_id";
