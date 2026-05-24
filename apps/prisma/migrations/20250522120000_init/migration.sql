-- Baseline schema (equivalent to former TypeORM migrations 1700000000000 + 1700000000001).
-- Existing DBs that already ran TypeORM: see docs/database-connection.md § Prisma baseline.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TYPE "user_role" AS ENUM ('client', 'provider', 'admin');
CREATE TYPE "booking_status" AS ENUM ('pending', 'confirmed', 'cancelled', 'completed');

CREATE TABLE "users" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "clerk_user_id" VARCHAR(128) NOT NULL,
    "email" VARCHAR(320) NOT NULL,
    "full_name" VARCHAR(255),
    "role" "user_role" NOT NULL DEFAULT 'client',
    "phone" VARCHAR(32),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "users_clerk_user_id_key" ON "users"("clerk_user_id");
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

CREATE TABLE "provider_profiles" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "display_name" VARCHAR(255) NOT NULL,
    "bio" TEXT,
    "city" VARCHAR(120),
    "service_radius_km" INTEGER NOT NULL DEFAULT 10,
    "is_active" BOOLEAN NOT NULL DEFAULT false,
    "is_verified" BOOLEAN NOT NULL DEFAULT false,
    "cronofy_profile_id" VARCHAR(128),
    "stripe_account_id" VARCHAR(128),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "provider_profiles_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "provider_profiles_user_id_key" ON "provider_profiles"("user_id");

ALTER TABLE "provider_profiles" ADD CONSTRAINT "provider_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "service_offers" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "provider_id" UUID NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "description" TEXT,
    "duration_minutes" INTEGER NOT NULL,
    "price_cents" INTEGER NOT NULL,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'EUR',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "service_offers_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ix_service_offers_provider_id" ON "service_offers"("provider_id");

ALTER TABLE "service_offers" ADD CONSTRAINT "service_offers_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "provider_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "availability_slots" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "provider_id" UUID NOT NULL,
    "starts_at" TIMESTAMPTZ(6) NOT NULL,
    "ends_at" TIMESTAMPTZ(6) NOT NULL,
    "is_booked" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "availability_slots_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ix_availability_slots_provider_id" ON "availability_slots"("provider_id");

ALTER TABLE "availability_slots" ADD CONSTRAINT "availability_slots_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "provider_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "bookings" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "client_id" UUID NOT NULL,
    "provider_id" UUID NOT NULL,
    "service_offer_id" UUID NOT NULL,
    "starts_at" TIMESTAMPTZ(6) NOT NULL,
    "ends_at" TIMESTAMPTZ(6) NOT NULL,
    "status" "booking_status" NOT NULL DEFAULT 'pending',
    "price_cents" INTEGER NOT NULL,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'EUR',
    "address_line" VARCHAR(255),
    "notes" TEXT,
    "stripe_payment_intent_id" VARCHAR(128),
    "cronofy_event_id" VARCHAR(128),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bookings_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ix_bookings_client_id" ON "bookings"("client_id");
CREATE INDEX "ix_bookings_provider_id" ON "bookings"("provider_id");

ALTER TABLE "bookings" ADD CONSTRAINT "bookings_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "provider_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_service_offer_id_fkey" FOREIGN KEY ("service_offer_id") REFERENCES "service_offers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "cms_pages" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "slug" VARCHAR(255) NOT NULL,
    "title" VARCHAR(255) NOT NULL,
    "hero" JSONB NOT NULL,
    "intro_blocks" JSONB NOT NULL,
    "how_it_works" JSONB NOT NULL,
    "reassurance_items" JSONB NOT NULL,
    "status" VARCHAR(32) NOT NULL DEFAULT 'published',
    "updated_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cms_pages_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "cms_pages_slug_key" ON "cms_pages"("slug");

ALTER TABLE "cms_pages" ADD CONSTRAINT "cms_pages_updated_by_user_id_fkey" FOREIGN KEY ("updated_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
