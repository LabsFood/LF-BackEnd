import { MigrationInterface, QueryRunner } from 'typeorm';

export class Init1700000000000 implements MigrationInterface {
  name = 'Init1700000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "pgcrypto"`);

    await queryRunner.query(
      `CREATE TYPE "user_role" AS ENUM('client', 'provider', 'admin')`,
    );
    await queryRunner.query(
      `CREATE TYPE "booking_status" AS ENUM('pending', 'confirmed', 'cancelled', 'completed')`,
    );

    await queryRunner.query(`
      CREATE TABLE "users" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "clerk_user_id" varchar(128) NOT NULL,
        "email" varchar(320) NOT NULL,
        "full_name" varchar(255),
        "role" "user_role" NOT NULL DEFAULT 'client',
        "phone" varchar(32),
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "uq_users_clerk_user_id" UNIQUE ("clerk_user_id"),
        CONSTRAINT "uq_users_email" UNIQUE ("email")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "provider_profiles" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "user_id" uuid NOT NULL,
        "display_name" varchar(255) NOT NULL,
        "bio" text,
        "city" varchar(120),
        "service_radius_km" integer NOT NULL DEFAULT 10,
        "is_active" boolean NOT NULL DEFAULT false,
        "is_verified" boolean NOT NULL DEFAULT false,
        "cronofy_profile_id" varchar(128),
        "stripe_account_id" varchar(128),
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "uq_provider_profiles_user_id" UNIQUE ("user_id"),
        CONSTRAINT "fk_provider_profiles_user_id" FOREIGN KEY ("user_id")
          REFERENCES "users"("id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "service_offers" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "provider_id" uuid NOT NULL,
        "name" varchar(160) NOT NULL,
        "description" text,
        "duration_minutes" integer NOT NULL,
        "price_cents" integer NOT NULL,
        "currency" varchar(3) NOT NULL DEFAULT 'EUR',
        "is_active" boolean NOT NULL DEFAULT true,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "fk_service_offers_provider_id" FOREIGN KEY ("provider_id")
          REFERENCES "provider_profiles"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "ix_service_offers_provider_id" ON "service_offers" ("provider_id")`,
    );

    await queryRunner.query(`
      CREATE TABLE "availability_slots" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "provider_id" uuid NOT NULL,
        "starts_at" TIMESTAMP WITH TIME ZONE NOT NULL,
        "ends_at" TIMESTAMP WITH TIME ZONE NOT NULL,
        "is_booked" boolean NOT NULL DEFAULT false,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "fk_availability_slots_provider_id" FOREIGN KEY ("provider_id")
          REFERENCES "provider_profiles"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "ix_availability_slots_provider_id" ON "availability_slots" ("provider_id")`,
    );

    await queryRunner.query(`
      CREATE TABLE "bookings" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "client_id" uuid NOT NULL,
        "provider_id" uuid NOT NULL,
        "service_offer_id" uuid NOT NULL,
        "starts_at" TIMESTAMP WITH TIME ZONE NOT NULL,
        "ends_at" TIMESTAMP WITH TIME ZONE NOT NULL,
        "status" "booking_status" NOT NULL DEFAULT 'pending',
        "price_cents" integer NOT NULL,
        "currency" varchar(3) NOT NULL DEFAULT 'EUR',
        "address_line" varchar(255),
        "notes" text,
        "stripe_payment_intent_id" varchar(128),
        "cronofy_event_id" varchar(128),
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "fk_bookings_client_id" FOREIGN KEY ("client_id")
          REFERENCES "users"("id") ON DELETE RESTRICT,
        CONSTRAINT "fk_bookings_provider_id" FOREIGN KEY ("provider_id")
          REFERENCES "provider_profiles"("id") ON DELETE RESTRICT,
        CONSTRAINT "fk_bookings_service_offer_id" FOREIGN KEY ("service_offer_id")
          REFERENCES "service_offers"("id") ON DELETE RESTRICT
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "ix_bookings_client_id" ON "bookings" ("client_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "ix_bookings_provider_id" ON "bookings" ("provider_id")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "bookings"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "availability_slots"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "service_offers"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "provider_profiles"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "users"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "booking_status"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "user_role"`);
  }
}
