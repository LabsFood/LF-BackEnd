-- FLOW-02 milestone 6: moderation after the fact (§4).
--
-- Publication is direct, so admins look afterwards. `review_pending_since` is set
-- when content needs a look (first publication, a safety edit after review, a
-- change to the suggestion it was adopted from, a republication after
-- suspension) and `review_reason` says which; the queue reads the non-null rows.
-- `moderation_*` hold the reason an admin gave when taking content down: the chef
-- reads it as written. Additive: every column is nullable.
-- AlterTable
ALTER TABLE "meals" ADD COLUMN     "moderated_at" TIMESTAMPTZ(6),
ADD COLUMN     "moderation_reason" TEXT,
ADD COLUMN     "moderation_reason_code" VARCHAR(40),
ADD COLUMN     "review_pending_since" TIMESTAMPTZ(6),
ADD COLUMN     "review_reason" VARCHAR(40),
ADD COLUMN     "reviewed_at" TIMESTAMPTZ(6);

-- AlterTable
ALTER TABLE "menus" ADD COLUMN     "moderated_at" TIMESTAMPTZ(6),
ADD COLUMN     "moderation_reason" TEXT,
ADD COLUMN     "moderation_reason_code" VARCHAR(40),
ADD COLUMN     "review_pending_since" TIMESTAMPTZ(6),
ADD COLUMN     "review_reason" VARCHAR(40),
ADD COLUMN     "reviewed_at" TIMESTAMPTZ(6);

-- CreateIndex
CREATE INDEX "ix_meals_review_pending_since" ON "meals"("review_pending_since");

-- CreateIndex
CREATE INDEX "ix_menus_review_pending_since" ON "menus"("review_pending_since");

-- The queue's own consistency, whatever writes it: a known reason, a reason and a
-- date together or neither, and never a suspension without the reason the chef
-- is shown. Every row starts with all of them NULL, so these validate at once.
ALTER TABLE "meals" ADD CONSTRAINT "chk_meals_review_reason" CHECK ("review_reason" IS NULL OR "review_reason" IN ('never-reviewed', 'edited-after-review', 'source-changed', 'republished-after-suspension'));
ALTER TABLE "meals" ADD CONSTRAINT "chk_meals_review_pending" CHECK (("review_reason" IS NULL) = ("review_pending_since" IS NULL));
ALTER TABLE "meals" ADD CONSTRAINT "chk_meals_suspension_reason" CHECK ("status"::text <> 'suspended' OR "moderation_reason" IS NOT NULL);

ALTER TABLE "menus" ADD CONSTRAINT "chk_menus_review_reason" CHECK ("review_reason" IS NULL OR "review_reason" IN ('never-reviewed', 'edited-after-review', 'source-changed', 'republished-after-suspension'));
ALTER TABLE "menus" ADD CONSTRAINT "chk_menus_review_pending" CHECK (("review_reason" IS NULL) = ("review_pending_since" IS NULL));
ALTER TABLE "menus" ADD CONSTRAINT "chk_menus_suspension_reason" CHECK ("status"::text <> 'suspended' OR "moderation_reason" IS NOT NULL);

