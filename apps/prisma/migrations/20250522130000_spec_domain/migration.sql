-- Spec domain entities (SPEC-BACKEND + SPEC-ADMIN). Extends Phase 1 + cms_pages baseline.

-- Extend booking lifecycle (spec) while keeping `completed` from Phase 1
ALTER TYPE "booking_status" ADD VALUE IF NOT EXISTS 'shopping';
ALTER TYPE "booking_status" ADD VALUE IF NOT EXISTS 'cooking';
ALTER TYPE "booking_status" ADD VALUE IF NOT EXISTS 'delivered';

ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "avatar_url" VARCHAR(512);

-- Spec enums
CREATE TYPE "client_profile_status" AS ENUM ('vip', 'active', 'prospect', 'inactive');
CREATE TYPE "meal_continent" AS ENUM ('europe', 'africa', 'asia', 'americas', 'middle_east');
CREATE TYPE "meal_difficulty" AS ENUM ('easy', 'medium', 'hard');
CREATE TYPE "meal_status" AS ENUM ('published', 'draft', 'archived');
CREATE TYPE "quote_status" AS ENUM ('submitted', 'in_review', 'quoted', 'accepted', 'declined');
CREATE TYPE "chat_message_from" AS ENUM ('client', 'admin');
CREATE TYPE "payment_status" AS ENUM ('pending', 'paid', 'refunded');
CREATE TYPE "notification_channel" AS ENUM ('email', 'sms', 'in_app');
CREATE TYPE "kossam_order_status" AS ENUM ('new', 'preparing', 'delivering', 'delivered', 'cancelled');
CREATE TYPE "kossam_payment_status" AS ENUM ('pending', 'paid', 'refunded');
CREATE TYPE "chef_application_status" AS ENUM ('new', 'reviewing', 'interview', 'accepted', 'rejected');
CREATE TYPE "application_document_type" AS ENUM ('cv', 'cover_letter', 'haccp', 'diploma', 'id_card', 'portfolio');
CREATE TYPE "application_document_format" AS ENUM ('pdf', 'image');
CREATE TYPE "contact_channel" AS ENUM ('form', 'whatsapp', 'email');
CREATE TYPE "contact_message_status" AS ENUM ('new', 'read', 'replied', 'archived');
CREATE TYPE "review_service" AS ENUM ('batch_cooking', 'atelier', 'kossam');
CREATE TYPE "team_member_role" AS ENUM ('founder', 'chef', 'staff');
CREATE TYPE "team_member_status" AS ENUM ('active', 'inactive');

-- Extend bookings (spec fields; table name unchanged)
ALTER TABLE "bookings" ADD COLUMN IF NOT EXISTS "reference" VARCHAR(32);
ALTER TABLE "bookings" ADD COLUMN IF NOT EXISTS "chef_user_id" UUID;
ALTER TABLE "bookings" ADD COLUMN IF NOT EXISTS "formule_id" VARCHAR(32);
ALTER TABLE "bookings" ADD COLUMN IF NOT EXISTS "booking_date" DATE;
ALTER TABLE "bookings" ADD COLUMN IF NOT EXISTS "time_slot" VARCHAR(64);
ALTER TABLE "bookings" ADD COLUMN IF NOT EXISTS "persons" INTEGER;
ALTER TABLE "bookings" ADD COLUMN IF NOT EXISTS "amount_ttc" INTEGER;
ALTER TABLE "bookings" ADD COLUMN IF NOT EXISTS "amount_after_tax" INTEGER;
ALTER TABLE "bookings" ADD COLUMN IF NOT EXISTS "shopping_by_client" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "bookings" ADD COLUMN IF NOT EXISTS "payment_id" UUID;

CREATE UNIQUE INDEX IF NOT EXISTS "bookings_reference_key" ON "bookings"("reference");
CREATE UNIQUE INDEX IF NOT EXISTS "bookings_payment_id_key" ON "bookings"("payment_id");

-- Formules before FK from bookings
CREATE TABLE "formules" (
    "id" VARCHAR(32) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "price_ttc" INTEGER NOT NULL,
    "price_after_tax" INTEGER NOT NULL,
    "duration" VARCHAR(64) NOT NULL,
    "meals_count" INTEGER NOT NULL,
    "persons" VARCHAR(64) NOT NULL,
    "features" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "popular" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "formules_pkey" PRIMARY KEY ("id")
);

INSERT INTO "formules" ("id", "name", "price_ttc", "price_after_tax", "duration", "meals_count", "persons", "features", "popular", "active")
VALUES
  ('essentiel', 'Essentiel', 0, 0, '', 3, '2-4', ARRAY[]::TEXT[], false, true),
  ('confort', 'Confort', 0, 0, '', 5, '2-6', ARRAY[]::TEXT[], true, true),
  ('premium', 'Premium', 0, 0, '', 7, '2-8', ARRAY[]::TEXT[], false, true),
  ('sur-mesure', 'Sur-mesure', 0, 0, '', 0, '', ARRAY[]::TEXT[], false, true)
ON CONFLICT ("id") DO NOTHING;

CREATE TABLE "client_profiles" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "dietary_preferences" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "allergies" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "dislikes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "favorites" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "spice_level" INTEGER,
    "household_adults" INTEGER NOT NULL DEFAULT 1,
    "household_kids" INTEGER NOT NULL DEFAULT 0,
    "kitchen_notes" TEXT,
    "address_street" VARCHAR(255),
    "address_city" VARCHAR(120),
    "address_postal_code" VARCHAR(16),
    "status" "client_profile_status" NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "client_profiles_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "client_profiles_user_id_key" ON "client_profiles"("user_id");
ALTER TABLE "client_profiles" ADD CONSTRAINT "client_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "meals" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" VARCHAR(255) NOT NULL,
    "description" TEXT,
    "image_url" VARCHAR(512),
    "continent" "meal_continent",
    "country" VARCHAR(120),
    "portions" INTEGER NOT NULL DEFAULT 4,
    "prep_time" INTEGER NOT NULL,
    "dietary_tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "allergens" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "calories" INTEGER,
    "difficulty" "meal_difficulty",
    "ingredients" JSONB NOT NULL DEFAULT '[]',
    "steps" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "is_featured" BOOLEAN NOT NULL DEFAULT false,
    "status" "meal_status" NOT NULL DEFAULT 'draft',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "meals_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "menu_weeks" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "week_number" INTEGER NOT NULL,
    "year" INTEGER NOT NULL,
    "published_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "menu_weeks_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "uq_menu_weeks_year_week" ON "menu_weeks"("year", "week_number");

CREATE TABLE "menu_week_meals" (
    "menu_week_id" UUID NOT NULL,
    "meal_id" UUID NOT NULL,
    CONSTRAINT "menu_week_meals_pkey" PRIMARY KEY ("menu_week_id", "meal_id")
);
ALTER TABLE "menu_week_meals" ADD CONSTRAINT "menu_week_meals_menu_week_id_fkey" FOREIGN KEY ("menu_week_id") REFERENCES "menu_weeks"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "menu_week_meals" ADD CONSTRAINT "menu_week_meals_meal_id_fkey" FOREIGN KEY ("meal_id") REFERENCES "meals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "payments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "stripe_payment_intent_id" VARCHAR(128) NOT NULL,
    "amount" INTEGER NOT NULL,
    "status" "payment_status" NOT NULL DEFAULT 'pending',
    "user_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "payments_stripe_payment_intent_id_key" ON "payments"("stripe_payment_intent_id");
ALTER TABLE "payments" ADD CONSTRAINT "payments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "bookings" ADD CONSTRAINT "bookings_chef_user_id_fkey" FOREIGN KEY ("chef_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_formule_id_fkey" FOREIGN KEY ("formule_id") REFERENCES "formules"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "booking_meals" (
    "booking_id" UUID NOT NULL,
    "meal_id" UUID NOT NULL,
    "portions" INTEGER NOT NULL DEFAULT 4,
    CONSTRAINT "booking_meals_pkey" PRIMARY KEY ("booking_id", "meal_id")
);
ALTER TABLE "booking_meals" ADD CONSTRAINT "booking_meals_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "booking_meals" ADD CONSTRAINT "booking_meals_meal_id_fkey" FOREIGN KEY ("meal_id") REFERENCES "meals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "shopping_lists" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "booking_id" UUID NOT NULL,
    "generated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "shopping_lists_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "shopping_lists_booking_id_key" ON "shopping_lists"("booking_id");
ALTER TABLE "shopping_lists" ADD CONSTRAINT "shopping_lists_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "shopping_items" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "shopping_list_id" UUID NOT NULL,
    "aisle" VARCHAR(120) NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "quantity" VARCHAR(64) NOT NULL,
    CONSTRAINT "shopping_items_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ix_shopping_items_list_id" ON "shopping_items"("shopping_list_id");
ALTER TABLE "shopping_items" ADD CONSTRAINT "shopping_items_shopping_list_id_fkey" FOREIGN KEY ("shopping_list_id") REFERENCES "shopping_lists"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "quotes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "reference" VARCHAR(32) NOT NULL,
    "client_id" UUID NOT NULL,
    "title" VARCHAR(255) NOT NULL,
    "persons" INTEGER NOT NULL,
    "meals_count" INTEGER NOT NULL,
    "cuisine" VARCHAR(120) NOT NULL,
    "diet" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "brief" TEXT NOT NULL,
    "status" "quote_status" NOT NULL DEFAULT 'submitted',
    "assigned_chef_user_id" UUID,
    "quote_amount_ttc" INTEGER,
    "quote_amount_after_tax" INTEGER,
    "quote_note" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "quotes_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "quotes_reference_key" ON "quotes"("reference");
CREATE INDEX "ix_quotes_client_id" ON "quotes"("client_id");
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_assigned_chef_user_id_fkey" FOREIGN KEY ("assigned_chef_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "chat_threads" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "client_id" UUID NOT NULL,
    "topic" VARCHAR(255) NOT NULL,
    "last_message_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "chat_threads_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ix_chat_threads_client_id" ON "chat_threads"("client_id");
ALTER TABLE "chat_threads" ADD CONSTRAINT "chat_threads_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "chat_messages" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "thread_id" UUID NOT NULL,
    "from" "chat_message_from" NOT NULL,
    "text" TEXT NOT NULL,
    "read" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "chat_messages_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ix_chat_messages_thread_id" ON "chat_messages"("thread_id");
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_thread_id_fkey" FOREIGN KEY ("thread_id") REFERENCES "chat_threads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "notifications" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "channel" "notification_channel" NOT NULL,
    "type" VARCHAR(64) NOT NULL,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "read_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ix_notifications_user_id" ON "notifications"("user_id");
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "team_members" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" VARCHAR(255) NOT NULL,
    "avatar_url" VARCHAR(512),
    "role" "team_member_role" NOT NULL,
    "specialty" VARCHAR(120) NOT NULL,
    "city" VARCHAR(120) NOT NULL,
    "phone" VARCHAR(32),
    "email" VARCHAR(320),
    "rating" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "review_count" INTEGER NOT NULL DEFAULT 0,
    "sessions_done" INTEGER NOT NULL DEFAULT 0,
    "status" "team_member_status" NOT NULL DEFAULT 'active',
    "badges" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "bio" TEXT,
    "joined_at" DATE NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "team_members_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "service_zones" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" VARCHAR(255) NOT NULL,
    "region" VARCHAR(120) NOT NULL,
    "postal_codes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "active" BOOLEAN NOT NULL DEFAULT true,
    "chefs_count" INTEGER NOT NULL DEFAULT 0,
    "clients_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "service_zones_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "kossam_orders" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "reference" VARCHAR(32) NOT NULL,
    "customer_name" VARCHAR(255) NOT NULL,
    "customer_email" VARCHAR(320) NOT NULL,
    "customer_phone" VARCHAR(32) NOT NULL,
    "total_cents" INTEGER NOT NULL,
    "delivery_fee_cents" INTEGER NOT NULL DEFAULT 0,
    "status" "kossam_order_status" NOT NULL DEFAULT 'new',
    "payment_status" "kossam_payment_status" NOT NULL DEFAULT 'pending',
    "payment_method" VARCHAR(64),
    "delivery_zone" VARCHAR(120) NOT NULL,
    "delivery_address" TEXT NOT NULL,
    "delivery_date" DATE NOT NULL,
    "delivery_slot" VARCHAR(64) NOT NULL,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "kossam_orders_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "kossam_orders_reference_key" ON "kossam_orders"("reference");

CREATE TABLE "kossam_order_items" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "order_id" UUID NOT NULL,
    "format" VARCHAR(16) NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unit_price_cents" INTEGER NOT NULL,
    CONSTRAINT "kossam_order_items_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ix_kossam_order_items_order_id" ON "kossam_order_items"("order_id");
ALTER TABLE "kossam_order_items" ADD CONSTRAINT "kossam_order_items_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "kossam_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "chef_applications" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" VARCHAR(255) NOT NULL,
    "email" VARCHAR(320) NOT NULL,
    "phone" VARCHAR(32) NOT NULL,
    "city" VARCHAR(120) NOT NULL,
    "birth_year" INTEGER NOT NULL,
    "experience_years" INTEGER NOT NULL,
    "current_role" VARCHAR(255) NOT NULL,
    "specialties" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "cuisines" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "languages" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "availability" VARCHAR(255) NOT NULL,
    "has_vehicle" BOOLEAN NOT NULL DEFAULT false,
    "expected_rate_cents" INTEGER NOT NULL,
    "motivation" TEXT NOT NULL,
    "has_haccp" BOOLEAN NOT NULL DEFAULT false,
    "status" "chef_application_status" NOT NULL DEFAULT 'new',
    "interview_date" DATE,
    "internal_notes" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "chef_applications_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "application_documents" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "application_id" UUID NOT NULL,
    "type" "application_document_type" NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "format" "application_document_format" NOT NULL,
    "size_kb" INTEGER NOT NULL,
    "url" VARCHAR(1024) NOT NULL,
    "pages" INTEGER,
    "uploaded_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "application_documents_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ix_application_documents_application_id" ON "application_documents"("application_id");
ALTER TABLE "application_documents" ADD CONSTRAINT "application_documents_application_id_fkey" FOREIGN KEY ("application_id") REFERENCES "chef_applications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "contact_messages" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" VARCHAR(255) NOT NULL,
    "email" VARCHAR(320) NOT NULL,
    "subject" VARCHAR(255) NOT NULL,
    "message" TEXT NOT NULL,
    "channel" "contact_channel" NOT NULL,
    "status" "contact_message_status" NOT NULL DEFAULT 'new',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "contact_messages_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "reviews" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "author" VARCHAR(255) NOT NULL,
    "city" VARCHAR(120) NOT NULL,
    "rating" INTEGER NOT NULL,
    "text" TEXT NOT NULL,
    "service" "review_service" NOT NULL,
    "source" VARCHAR(120) NOT NULL,
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "published" BOOLEAN NOT NULL DEFAULT false,
    "review_date" DATE NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "reviews_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "admin_settings" (
    "id" VARCHAR(32) NOT NULL DEFAULT 'default',
    "company_name" VARCHAR(255) NOT NULL,
    "contact_email" VARCHAR(320) NOT NULL,
    "service_area" VARCHAR(255) NOT NULL,
    "vat_rate" INTEGER NOT NULL DEFAULT 20,
    "tax_credit_rate" INTEGER NOT NULL DEFAULT 50,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'EUR',
    "notifications" JSONB NOT NULL DEFAULT '{}',
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "admin_settings_pkey" PRIMARY KEY ("id")
);

INSERT INTO "admin_settings" ("id", "company_name", "contact_email", "service_area")
VALUES ('default', 'Labs Food', 'contact@labsfood.com', 'Côte d''Azur')
ON CONFLICT ("id") DO NOTHING;
