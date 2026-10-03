-- FLOW-02 milestone 3: menus, the dishes they hold, and the weekly showcase.
--
-- `menus` mirrors the ownership of `meals`: `chef_profile_id` null is Lab's Food
-- content. `menu_dishes` is many-to-many, so a dish can sit in several menus.
-- `chef_showcase_weeks` says which menu a chef shows each week; `menu_id` null is
-- "no menu this week", said explicitly. The new `suspended` status is how an
-- admin takes a chef's content down (§4.3).
-- CreateEnum
CREATE TYPE "menu_period" AS ENUM ('week', 'month');

-- AlterEnum
ALTER TYPE "meal_status" ADD VALUE 'suspended';

-- CreateTable
CREATE TABLE "menus" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "chef_profile_id" UUID,
    "created_by_user_id" UUID,
    "title" VARCHAR(160) NOT NULL,
    "pitch" VARCHAR(500),
    "period" "menu_period" NOT NULL DEFAULT 'week',
    "status" "meal_status" NOT NULL DEFAULT 'draft',
    "shopping_included" BOOLEAN NOT NULL DEFAULT false,
    "published_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "menus_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "menu_dishes" (
    "menu_id" UUID NOT NULL,
    "meal_id" UUID NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "menu_dishes_pkey" PRIMARY KEY ("menu_id","meal_id")
);

-- CreateTable
CREATE TABLE "chef_showcase_weeks" (
    "chef_profile_id" UUID NOT NULL,
    "week_start" DATE NOT NULL,
    "menu_id" UUID,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chef_showcase_weeks_pkey" PRIMARY KEY ("chef_profile_id","week_start")
);

-- CreateIndex
CREATE INDEX "ix_menus_chef_profile_id" ON "menus"("chef_profile_id");

-- CreateIndex
CREATE INDEX "ix_menus_created_by_user_id" ON "menus"("created_by_user_id");

-- CreateIndex
CREATE INDEX "ix_menu_dishes_meal_id" ON "menu_dishes"("meal_id");

-- CreateIndex
CREATE INDEX "ix_chef_showcase_weeks_week_start" ON "chef_showcase_weeks"("week_start");

-- CreateIndex
CREATE INDEX "ix_chef_showcase_weeks_menu_id" ON "chef_showcase_weeks"("menu_id");

-- AddForeignKey
ALTER TABLE "menus" ADD CONSTRAINT "fk_menus_chef_profile_id" FOREIGN KEY ("chef_profile_id") REFERENCES "chef_profiles"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "menus" ADD CONSTRAINT "fk_menus_created_by_user_id" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "menu_dishes" ADD CONSTRAINT "fk_menu_dishes_menu_id" FOREIGN KEY ("menu_id") REFERENCES "menus"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "menu_dishes" ADD CONSTRAINT "fk_menu_dishes_meal_id" FOREIGN KEY ("meal_id") REFERENCES "meals"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "chef_showcase_weeks" ADD CONSTRAINT "fk_chef_showcase_weeks_chef_profile_id" FOREIGN KEY ("chef_profile_id") REFERENCES "chef_profiles"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "chef_showcase_weeks" ADD CONSTRAINT "fk_chef_showcase_weeks_menu_id" FOREIGN KEY ("menu_id") REFERENCES "menus"("id") ON DELETE SET NULL ON UPDATE NO ACTION;


-- `suspended` belongs to moderation of a chef's content: Lab's Food retires its own
-- with `archived`. Compared as text, because Postgres refuses a new enum value used
-- in the same transaction that adds it.
ALTER TABLE "meals" ADD CONSTRAINT "chk_meals_suspended_owned"
  CHECK ("status"::text <> 'suspended' OR "chef_profile_id" IS NOT NULL);

ALTER TABLE "menus" ADD CONSTRAINT "chk_menus_suspended_owned"
  CHECK ("status"::text <> 'suspended' OR "chef_profile_id" IS NOT NULL);

-- A showcase week always starts on a Monday (ISO day 1).
ALTER TABLE "chef_showcase_weeks" ADD CONSTRAINT "chk_chef_showcase_weeks_monday"
  CHECK (EXTRACT(ISODOW FROM "week_start") = 1);
