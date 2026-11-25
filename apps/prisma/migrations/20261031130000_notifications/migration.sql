-- In-app notifications (Recettes §12): the bell of the client and batch cooker
-- spaces. A row holds a type and the thing it is about, never what it says: no
-- allergy, no personal data. No e-mail is sent from it.
--
-- The first schema (20250522130000_spec_domain) created a "notifications" table
-- (channel, payload) that no model has used since. It is replaced here. The guard
-- refuses to drop it if it ever received a row: move them first.

DO $$
BEGIN
  IF to_regclass('public.notifications') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM "notifications" LIMIT 1) THEN
      RAISE EXCEPTION 'The legacy notifications table holds rows: move them before this migration.';
    END IF;
  END IF;
END $$;

-- DropTable, DropEnum: the legacy ones, empty.
DROP TABLE IF EXISTS "notifications";
DROP TYPE IF EXISTS "notification_channel";

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "type" VARCHAR(64) NOT NULL,
    "subject_type" VARCHAR(32) NOT NULL,
    "subject_id" UUID NOT NULL,
    "read_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: the bell lists a person's newest first.
CREATE INDEX "ix_notifications_user_id_created_at" ON "notifications"("user_id", "created_at");

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "fk_notifications_user_id" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
