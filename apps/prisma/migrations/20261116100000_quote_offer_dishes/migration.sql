-- Custom requests: the batch cooker puts dishes in an offer (their published
-- dishes and menus, and express dishes written for the request). Additive and
-- replayable.

-- Express dishes: written for one request, out of the catalogue until the batch
-- cooker keeps or drops them after the prestation.
ALTER TABLE "meals" ADD COLUMN IF NOT EXISTS "express_quote_id" UUID;
ALTER TABLE "meals" ADD COLUMN IF NOT EXISTS "express_decision" VARCHAR(8);
ALTER TABLE "meals" ADD COLUMN IF NOT EXISTS "express_decided_at" TIMESTAMPTZ(6);

DO $$ BEGIN
  ALTER TABLE "meals" ADD CONSTRAINT "fk_meals_express_quote_id"
    FOREIGN KEY ("express_quote_id") REFERENCES "quotes"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "meals" ADD CONSTRAINT "ck_meals_express_decision"
    CHECK ("express_decision" IS NULL OR "express_decision" IN ('kept', 'dropped'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS "ix_meals_express_quote_id" ON "meals"("express_quote_id");

-- The dishes of an offer.
CREATE TABLE IF NOT EXISTS "quote_offer_dishes" (
    "offer_id" UUID NOT NULL,
    "meal_id" UUID NOT NULL,
    "menu_id" UUID,
    "position" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "quote_offer_dishes_pkey" PRIMARY KEY ("offer_id", "meal_id")
);

CREATE INDEX IF NOT EXISTS "ix_quote_offer_dishes_meal_id" ON "quote_offer_dishes"("meal_id");

DO $$ BEGIN
  ALTER TABLE "quote_offer_dishes" ADD CONSTRAINT "fk_quote_offer_dishes_offer_id"
    FOREIGN KEY ("offer_id") REFERENCES "quote_offers"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "quote_offer_dishes" ADD CONSTRAINT "fk_quote_offer_dishes_meal_id"
    FOREIGN KEY ("meal_id") REFERENCES "meals"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "quote_offer_dishes" ADD CONSTRAINT "fk_quote_offer_dishes_menu_id"
    FOREIGN KEY ("menu_id") REFERENCES "menus"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
