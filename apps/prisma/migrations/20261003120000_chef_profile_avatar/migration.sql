-- A batch cooker's profile photo, served from Cloudflare R2 like dish photos.
--
-- Nullable: every existing profile simply has no photo yet. Additive.
-- `users.avatar_url` (20250522130000_spec_domain) is a different, unmapped column
-- and is left as it is.
ALTER TABLE "chef_profiles" ADD COLUMN     "avatar_url" VARCHAR(512);
