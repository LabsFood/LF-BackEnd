-- Contact forms: what the public sites receive, and what the team answered.
--
-- `contact_messages` and its status enum already exist: 20250522130000_spec_domain
-- created them for a model that was never written, with a `channel` column this
-- one does not have. No code ever read or wrote that table. It is renamed aside,
-- not dropped, as 20260920120000_chef_onboarding did for the candidature tables:
-- drop `contact_messages_legacy` once production is confirmed empty.
DO $$
BEGIN
  IF EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'contact_messages' AND column_name = 'channel'
     )
     AND to_regclass('public.contact_messages_legacy') IS NULL THEN
    ALTER TABLE "contact_messages" RENAME TO "contact_messages_legacy";
    ALTER TABLE "contact_messages_legacy"
      RENAME CONSTRAINT "contact_messages_pkey" TO "contact_messages_legacy_pkey";
  END IF;

  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'contact_message_status')
     AND NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'contact_message_status_legacy') THEN
    ALTER TYPE "contact_message_status" RENAME TO "contact_message_status_legacy";
  END IF;
END $$;

-- CreateEnum
CREATE TYPE "contact_message_status" AS ENUM ('new', 'read', 'replied', 'archived');

-- CreateTable
CREATE TABLE "contact_messages" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "source" VARCHAR(24) NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "email" VARCHAR(320) NOT NULL,
    "phone" VARCHAR(32),
    "subject" VARCHAR(160) NOT NULL,
    "message" TEXT NOT NULL,
    "status" "contact_message_status" NOT NULL DEFAULT 'new',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contact_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contact_message_replies" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "contact_message_id" UUID NOT NULL,
    "body" TEXT NOT NULL,
    "sent_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contact_message_replies_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ix_contact_messages_status_created_at" ON "contact_messages"("status", "created_at");

-- CreateIndex
CREATE INDEX "ix_contact_message_replies_contact_message_id" ON "contact_message_replies"("contact_message_id");

-- AddForeignKey
ALTER TABLE "contact_message_replies" ADD CONSTRAINT "fk_contact_message_replies_contact_message_id" FOREIGN KEY ("contact_message_id") REFERENCES "contact_messages"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "contact_message_replies" ADD CONSTRAINT "fk_contact_message_replies_sent_by_user_id" FOREIGN KEY ("sent_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- Only the sites that have a form. A new site is one more value here.
ALTER TABLE "contact_messages" ADD CONSTRAINT "chk_contact_messages_source" CHECK ("source" IN ('labsfood', 'batchcooking'));
