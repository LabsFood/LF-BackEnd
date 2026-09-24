-- FLOW-02 milestone 8: recipe versions and the prestation's documents (§7, §9.2).
--
-- `meals.recipe_version` counts the recipe's versions: every change to ingredients,
-- steps, reheating, storage or portions adds one. A booking pins the version it
-- cooks from (`booking_meals.recipe_version`), and `meal_recipe_versions` keeps
-- that version's content from the moment it is pinned, so the shopping list made
-- before the prestation and the fiche handed over after it always agree.
-- `shopping_items` gains a number and a unit, and marks the lines the batch cooker
-- changed or struck out: those survive a recalculation. Additive: existing meals
-- start at version 1, existing bookings pin on first use.

-- AlterTable
ALTER TABLE "meals" ADD COLUMN     "recipe_version" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "booking_meals" ADD COLUMN     "recipe_version" INTEGER;

-- AlterTable
ALTER TABLE "shopping_items" ADD COLUMN     "edited" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "qty" DOUBLE PRECISION,
ADD COLUMN     "removed" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "unit" VARCHAR(32);

-- CreateTable
CREATE TABLE "meal_recipe_versions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "meal_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "portions" INTEGER NOT NULL,
    "ingredients" JSONB NOT NULL DEFAULT '[]',
    "steps" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "reheating" JSONB,
    "storage" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "meal_recipe_versions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "uq_meal_recipe_versions_meal_version" ON "meal_recipe_versions"("meal_id", "version");

-- CreateIndex
CREATE INDEX "ix_booking_meals_meal_id" ON "booking_meals"("meal_id");

-- AddForeignKey
ALTER TABLE "booking_meals" ADD CONSTRAINT "fk_booking_meals_recipe_version" FOREIGN KEY ("meal_id", "recipe_version") REFERENCES "meal_recipe_versions"("meal_id", "version") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "meal_recipe_versions" ADD CONSTRAINT "fk_meal_recipe_versions_meal_id" FOREIGN KEY ("meal_id") REFERENCES "meals"("id") ON DELETE CASCADE ON UPDATE NO ACTION;


-- A pinned version is kept (the foreign key above is RESTRICT) and never below 1.
ALTER TABLE "meals" ADD CONSTRAINT "chk_meals_recipe_version" CHECK ("recipe_version" >= 1);
