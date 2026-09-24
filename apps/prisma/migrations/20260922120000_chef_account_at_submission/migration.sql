-- FLOW-01 rework: the account exists from candidature submission.
--
-- Submitting a candidature now creates the Clerk user, the `users` row and an
-- unverified chef profile together. The candidate works signed in instead of with a
-- scoped token, and documents belong to the chef profile from the first upload.
-- What bridged the gap between candidature and account goes.

-- ---------------------------------------------------- chef_applications

-- The candidate token and its resend cap.
ALTER TABLE "chef_applications"
  DROP COLUMN IF EXISTS "token_hash",
  DROP COLUMN IF EXISTS "token_expires_at",
  DROP COLUMN IF EXISTS "resend_count",
  DROP COLUMN IF EXISTS "resend_window_started_at";

-- The user is reached through the chef profile; a second pointer could only
-- disagree with it. Dropping the column takes its unique index and foreign key.
ALTER TABLE "chef_applications" DROP COLUMN IF EXISTS "approved_user_id";

-- One live candidature per address is now one account per address
-- (`uq_users_email`) and one candidature per chef profile
-- (`uq_chef_applications_chef_profile_id`).
DROP INDEX IF EXISTS "uq_chef_applications_email_pending";

-- ------------------------------------------------------- chef_documents

-- Dropping the column also drops the unique index, the foreign key and the owner
-- CHECK that referenced it.
ALTER TABLE "chef_documents" DROP COLUMN IF EXISTS "application_id";

-- Fails on purpose if a candidature-era document with no chef profile exists: under
-- the old model its candidate has no account to reach it from, and deleting an
-- identity document silently is not this migration's call. None existed on DEV.
ALTER TABLE "chef_documents" ALTER COLUMN "chef_profile_id" SET NOT NULL;

DROP INDEX IF EXISTS "ix_chef_documents_chef_profile_type_version";
CREATE UNIQUE INDEX IF NOT EXISTS "uq_chef_documents_chef_profile_type_version"
  ON "chef_documents" ("chef_profile_id", "type", "version");
