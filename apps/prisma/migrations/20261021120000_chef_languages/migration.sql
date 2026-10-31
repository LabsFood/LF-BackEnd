-- Languages a batch cooker speaks with clients: ISO 639-1 codes from
-- `GET /referentials/languages`, checked by the API. Shown on the public page.
-- Existing profiles start with none.

-- AlterTable
ALTER TABLE "chef_profiles" ADD COLUMN "languages" TEXT[] DEFAULT ARRAY[]::TEXT[];
