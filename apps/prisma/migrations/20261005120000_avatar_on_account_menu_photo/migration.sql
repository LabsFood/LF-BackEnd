-- The profile photo belongs to the account, so clients and admins can have one too.
--
-- `users.avatar_url` was added by 20250522130000_spec_domain and never used; IF NOT
-- EXISTS covers a database where it is missing. A batch cooker's photo moves from
-- their chef profile before that column goes.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "avatar_url" VARCHAR(512);

ALTER TABLE "chef_profiles" DROP COLUMN "avatar_url";

-- Menus get a cover photo, as dishes have. Nullable, additive.
ALTER TABLE "menus" ADD COLUMN "image_url" VARCHAR(512);
