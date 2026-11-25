-- Recettes lot 3 (LF-0270): the « à manger avant » date of each dish of a prestation.
-- Null on `booking_meals`: the platform's date (prestation day + fridge days of the
-- pinned recipe). Each date the chef sets is kept in `booking_meal_date_changes`.
-- Additive and replayable.
ALTER TABLE "booking_meals"
ADD COLUMN IF NOT EXISTS "eat_before" DATE,
ADD COLUMN IF NOT EXISTS "eat_before_set_at" TIMESTAMPTZ(6),
ADD COLUMN IF NOT EXISTS "eat_before_set_by_user_id" UUID;

CREATE TABLE IF NOT EXISTS "booking_meal_date_changes" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "booking_id" UUID NOT NULL,
  "meal_id" UUID NOT NULL,
  "value" DATE,
  "changed_by_user_id" UUID,
  "changed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  CONSTRAINT "booking_meal_date_changes_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "fk_booking_meal_date_changes_booking_id" FOREIGN KEY ("booking_id")
    REFERENCES "bookings"("id") ON DELETE CASCADE ON UPDATE NO ACTION
);

CREATE INDEX IF NOT EXISTS "ix_booking_meal_date_changes_booking_changed"
  ON "booking_meal_date_changes" ("booking_id", "changed_at");
