-- Recettes R34: four tiers an admin sets on each batch cooker. Neutral codes: the
-- labels shown live in the `chef_tiers` platform setting, so renaming a tier needs
-- no migration. Existing profiles start at the first tier.

-- CreateEnum
CREATE TYPE "chef_tier" AS ENUM ('tier_1', 'tier_2', 'tier_3', 'tier_4');

-- AlterTable
ALTER TABLE "chef_profiles" ADD COLUMN "tier" "chef_tier" NOT NULL DEFAULT 'tier_1';
