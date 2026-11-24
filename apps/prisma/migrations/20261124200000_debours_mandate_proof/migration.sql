-- The débours mandate proof (IP and browser) kept when the box is ticked, not later.
ALTER TABLE "bookings" ADD COLUMN IF NOT EXISTS "debours_mandate_ip" VARCHAR(64);
ALTER TABLE "bookings" ADD COLUMN IF NOT EXISTS "debours_mandate_user_agent" VARCHAR(512);
