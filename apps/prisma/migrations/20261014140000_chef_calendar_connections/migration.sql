-- A batch cooker's calendar, linked through Cronofy (data center `de`): its busy
-- time is taken out of their availability, and their bookings are written to it.
-- The OAuth tokens are sealed with AES-256-GCM by the API (CRONOFY_TOKEN_KEY);
-- nothing here is readable without that key.

-- CreateTable
CREATE TABLE "chef_calendar_connections" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "chef_profile_id" UUID NOT NULL,
    "cronofy_sub" VARCHAR(128) NOT NULL,
    "provider_name" VARCHAR(64),
    "profile_name" VARCHAR(255),
    "calendar_id" VARCHAR(128),
    "access_token_sealed" TEXT NOT NULL,
    "refresh_token_sealed" TEXT NOT NULL,
    "access_token_expires_at" TIMESTAMPTZ(6) NOT NULL,
    "status" VARCHAR(16) NOT NULL DEFAULT 'active',
    "last_error" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chef_calendar_connections_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ck_chef_calendar_connections_status" CHECK ("status" IN ('active', 'revoked'))
);

-- CreateIndex
CREATE UNIQUE INDEX "uq_chef_calendar_connections_chef_profile_id" ON "chef_calendar_connections"("chef_profile_id");

-- AddForeignKey
ALTER TABLE "chef_calendar_connections" ADD CONSTRAINT "fk_chef_calendar_connections_chef_profile_id" FOREIGN KEY ("chef_profile_id") REFERENCES "chef_profiles"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
