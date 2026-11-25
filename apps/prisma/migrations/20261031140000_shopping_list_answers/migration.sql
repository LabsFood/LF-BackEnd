-- Recettes lot 4, client part (§10.7, case 1): the batch cooker sends the list, the
-- client answers it ("I already have it", a comment per line) until noon the day
-- before. Columns only, each nullable or with a default: nothing to backfill.

-- AlterTable
ALTER TABLE "shopping_lists" ADD COLUMN     "client_marks" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "final_received_at" TIMESTAMPTZ(6),
ADD COLUMN     "sent_at" TIMESTAMPTZ(6),
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 0;
