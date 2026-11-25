-- Recettes §7.3, ruling R28: a change to an entry of the common list is committed
-- first, then carried into the recipes linking it, dish by dish, inside the request.
-- A process cut short (a deploy, a restart) left the remaining dishes verified on the
-- entry as it was, with nothing to say so. `carry_pending_at` is set in the same
-- transaction as such a change, and cleared only when a carry or a replay of the entry
-- ends with no failed dish; the console lists the entries still pending, to replay.
-- Additive and replayable: a nullable column, no default, no rewrite of the table.
ALTER TABLE "catalog_ingredients"
ADD COLUMN IF NOT EXISTS "carry_pending_at" TIMESTAMPTZ(6);
