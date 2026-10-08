-- The profile photo belongs to the account, so clients and admins can have one too.
--
-- `users.avatar_url` was added by 20250522130000_spec_domain and never used; IF NOT
-- EXISTS covers a database where it is missing. A batch cooker's photo moves from
-- their chef profile before that column goes.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "avatar_url" VARCHAR(512);

-- IF EXISTS: the column came from 20261003120000_chef_profile_avatar, which was
-- removed from the repo. Databases that ran it have the column; a fresh one never
-- did, and a plain DROP stopped every migration there.
ALTER TABLE "chef_profiles" DROP COLUMN IF EXISTS "avatar_url";

-- Menus get a cover photo, as dishes have. Nullable, additive.
ALTER TABLE "menus" ADD COLUMN "image_url" VARCHAR(512);
