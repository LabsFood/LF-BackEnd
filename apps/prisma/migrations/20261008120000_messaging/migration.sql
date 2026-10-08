-- Messaging: conversations, their participants, messages and attachments.
--
-- A `chef_client` conversation is unique per (client, batch cooker) pair; a
-- `support` one is unique per user, with the team as a shared inbox. Message
-- bodies are stored as written: masking of phone numbers and emails happens when
-- a message is served. Additive: four new tables, nothing existing is touched.
-- CreateEnum
CREATE TYPE "conversation_type" AS ENUM ('chef_client', 'support');

-- CreateEnum
CREATE TYPE "message_sender_role" AS ENUM ('client', 'chef', 'support');

-- CreateTable
CREATE TABLE "conversations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "type" "conversation_type" NOT NULL,
    "client_id" UUID,
    "chef_profile_id" UUID,
    "support_user_id" UUID,
    "last_message_at" TIMESTAMPTZ(6),
    "contact_flagged_at" TIMESTAMPTZ(6),
    "admin_unread_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversation_participants" (
    "conversation_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role" "message_sender_role" NOT NULL,
    "unread_count" INTEGER NOT NULL DEFAULT 0,
    "last_read_at" TIMESTAMPTZ(6),
    "last_emailed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pk_conversation_participants" PRIMARY KEY ("conversation_id","user_id")
);

-- CreateTable
CREATE TABLE "messages" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "conversation_id" UUID NOT NULL,
    "sender_user_id" UUID,
    "sender_role" "message_sender_role" NOT NULL,
    "body" TEXT NOT NULL,
    "contact_detected" BOOLEAN NOT NULL DEFAULT false,
    "client_message_id" VARCHAR(64),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "message_attachments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "message_id" UUID NOT NULL,
    "conversation_id" UUID NOT NULL,
    "uploader_user_id" UUID,
    "storage_path" VARCHAR(512) NOT NULL,
    "file_name" VARCHAR(255) NOT NULL,
    "mime_type" VARCHAR(127) NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "message_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "uq_conversations_support_user_id" ON "conversations"("support_user_id");

-- CreateIndex
CREATE INDEX "ix_conversations_chef_profile_id" ON "conversations"("chef_profile_id");

-- CreateIndex
CREATE INDEX "ix_conversations_type_last_message_at" ON "conversations"("type", "last_message_at");

-- CreateIndex
CREATE UNIQUE INDEX "uq_conversations_client_chef" ON "conversations"("client_id", "chef_profile_id");

-- CreateIndex
CREATE INDEX "ix_conversation_participants_user_id" ON "conversation_participants"("user_id");

-- CreateIndex
CREATE INDEX "ix_messages_conversation_created_at" ON "messages"("conversation_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "uq_messages_client_message_id" ON "messages"("conversation_id", "sender_user_id", "client_message_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_message_attachments_storage_path" ON "message_attachments"("storage_path");

-- CreateIndex
CREATE INDEX "ix_message_attachments_message_id" ON "message_attachments"("message_id");

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "fk_conversations_client_id" FOREIGN KEY ("client_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "fk_conversations_chef_profile_id" FOREIGN KEY ("chef_profile_id") REFERENCES "chef_profiles"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "fk_conversations_support_user_id" FOREIGN KEY ("support_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "conversation_participants" ADD CONSTRAINT "fk_conversation_participants_conversation_id" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "conversation_participants" ADD CONSTRAINT "fk_conversation_participants_user_id" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "fk_messages_conversation_id" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "fk_messages_sender_user_id" FOREIGN KEY ("sender_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "message_attachments" ADD CONSTRAINT "fk_message_attachments_message_id" FOREIGN KEY ("message_id") REFERENCES "messages"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "message_attachments" ADD CONSTRAINT "fk_message_attachments_conversation_id" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "message_attachments" ADD CONSTRAINT "fk_message_attachments_uploader_user_id" FOREIGN KEY ("uploader_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION;


-- A conversation is one shape or the other, never a mix, whatever writes it.
ALTER TABLE "conversations" ADD CONSTRAINT "chk_conversations_shape" CHECK (
  ("type" = 'chef_client' AND "client_id" IS NOT NULL AND "chef_profile_id" IS NOT NULL AND "support_user_id" IS NULL)
  OR ("type" = 'support' AND "support_user_id" IS NOT NULL AND "client_id" IS NULL AND "chef_profile_id" IS NULL)
);
