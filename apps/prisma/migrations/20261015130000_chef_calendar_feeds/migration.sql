-- The batch cooker's calendar feed (in-house calendar, phase D2): a private
-- `.ics` link their calendar app subscribes to. Only the token's SHA-256 is
-- stored; the link is shown once. No row means the feed is off.
--
-- `last_fetched_at`: when a calendar app last fetched it (written at most once an
-- hour). The admin console's `calendarConnected` reads it: fetched within 7 days.

-- CreateTable
CREATE TABLE "chef_calendar_feeds" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "chef_profile_id" UUID NOT NULL,
    "token_hash" VARCHAR(64) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "rotated_at" TIMESTAMPTZ(6),
    "last_fetched_at" TIMESTAMPTZ(6),

    CONSTRAINT "chef_calendar_feeds_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "uq_chef_calendar_feeds_chef_profile_id" ON "chef_calendar_feeds"("chef_profile_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_chef_calendar_feeds_token_hash" ON "chef_calendar_feeds"("token_hash");

-- AddForeignKey
ALTER TABLE "chef_calendar_feeds" ADD CONSTRAINT "fk_chef_calendar_feeds_chef_profile_id" FOREIGN KEY ("chef_profile_id") REFERENCES "chef_profiles"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
