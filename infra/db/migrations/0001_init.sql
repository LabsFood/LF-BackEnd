-- Labs Food — initial schema baseline.
-- Mirrors apps/api-fastapi/alembic/versions/0001_init.py.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

DO $$ BEGIN
  CREATE TYPE user_role AS ENUM ('client', 'provider', 'admin');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE booking_status AS ENUM ('pending', 'confirmed', 'cancelled', 'completed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clerk_user_id varchar(128) NOT NULL UNIQUE,
  email varchar(320) NOT NULL UNIQUE,
  full_name varchar(255),
  role user_role NOT NULL DEFAULT 'client',
  phone varchar(32),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS provider_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  display_name varchar(255) NOT NULL,
  bio text,
  city varchar(120),
  service_radius_km integer NOT NULL DEFAULT 10,
  is_active boolean NOT NULL DEFAULT false,
  is_verified boolean NOT NULL DEFAULT false,
  cronofy_profile_id varchar(128),
  stripe_account_id varchar(128),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS service_offers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id uuid NOT NULL REFERENCES provider_profiles(id) ON DELETE CASCADE,
  name varchar(160) NOT NULL,
  description text,
  duration_minutes integer NOT NULL,
  price_cents integer NOT NULL,
  currency varchar(3) NOT NULL DEFAULT 'EUR',
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_service_offers_provider_id
  ON service_offers(provider_id);

CREATE TABLE IF NOT EXISTS availability_slots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id uuid NOT NULL REFERENCES provider_profiles(id) ON DELETE CASCADE,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  is_booked boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_availability_slots_provider_id
  ON availability_slots(provider_id);

CREATE TABLE IF NOT EXISTS bookings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  provider_id uuid NOT NULL REFERENCES provider_profiles(id) ON DELETE RESTRICT,
  service_offer_id uuid NOT NULL REFERENCES service_offers(id) ON DELETE RESTRICT,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  status booking_status NOT NULL DEFAULT 'pending',
  price_cents integer NOT NULL,
  currency varchar(3) NOT NULL DEFAULT 'EUR',
  address_line varchar(255),
  notes text,
  stripe_payment_intent_id varchar(128),
  cronofy_event_id varchar(128),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_bookings_client_id ON bookings(client_id);
CREATE INDEX IF NOT EXISTS ix_bookings_provider_id ON bookings(provider_id);
