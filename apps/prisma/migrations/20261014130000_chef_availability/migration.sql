-- A batch cooker's working hours: a weekly template plus dated exceptions, in
-- minutes since midnight, Paris time (the model of batchcooking-web's agenda).
-- Bookings are checked against them, minus other bookings and calendar busy time.
--
-- `hold_reminder_sent_at`: an unpaid `pending` booking holds its slot 72 h; the
-- reminder sent at 48 h is claimed through this column so it goes out once, even
-- with several API instances running the hourly job.

-- AlterTable
ALTER TABLE "bookings" ADD COLUMN IF NOT EXISTS "hold_reminder_sent_at" TIMESTAMPTZ(6);

-- CreateTable
CREATE TABLE "chef_working_hours" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "chef_profile_id" UUID NOT NULL,
    "weekday" INTEGER NOT NULL,
    "start_minute" INTEGER NOT NULL,
    "end_minute" INTEGER NOT NULL,

    CONSTRAINT "chef_working_hours_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ck_chef_working_hours_weekday" CHECK ("weekday" BETWEEN 0 AND 6),
    CONSTRAINT "ck_chef_working_hours_range" CHECK (
      "start_minute" >= 0 AND "start_minute" < "end_minute" AND "end_minute" <= 1440
    )
);

-- CreateTable
CREATE TABLE "chef_availability_exceptions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "chef_profile_id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "kind" VARCHAR(8) NOT NULL,
    "start_minute" INTEGER,
    "end_minute" INTEGER,
    "reason" VARCHAR(255),

    CONSTRAINT "chef_availability_exceptions_pkey" PRIMARY KEY ("id"),
    -- `closed` takes the whole day; `extra` adds one range to it.
    CONSTRAINT "ck_chef_availability_exceptions_kind" CHECK (
      ("kind" = 'closed' AND "start_minute" IS NULL AND "end_minute" IS NULL)
      OR ("kind" = 'extra' AND "start_minute" >= 0 AND "start_minute" < "end_minute"
          AND "end_minute" <= 1440)
    )
);

-- CreateIndex
CREATE INDEX "ix_chef_working_hours_chef_profile_id" ON "chef_working_hours"("chef_profile_id");

-- CreateIndex
CREATE INDEX "ix_chef_availability_exceptions_chef_date" ON "chef_availability_exceptions"("chef_profile_id", "date");

-- AddForeignKey
ALTER TABLE "chef_working_hours" ADD CONSTRAINT "fk_chef_working_hours_chef_profile_id" FOREIGN KEY ("chef_profile_id") REFERENCES "chef_profiles"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "chef_availability_exceptions" ADD CONSTRAINT "fk_chef_availability_exceptions_chef_profile_id" FOREIGN KEY ("chef_profile_id") REFERENCES "chef_profiles"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
