-- Shopping list: the client reads the version sent (a snapshot), ticks are saved
-- one by one, the batch cooker answers comments and marks what they bring.
ALTER TABLE "shopping_lists"
  ADD COLUMN "sent_lines" JSONB,
  ADD COLUMN "marks_version" INTEGER,
  ADD COLUMN "marks_updated_at" TIMESTAMPTZ(6),
  ADD COLUMN "chef_replies" JSONB NOT NULL DEFAULT '[]';

ALTER TABLE "shopping_items"
  ADD COLUMN "provided_by_chef" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "chef_profiles"
  ADD COLUMN "pantry_staples" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

-- Backfill: a list already sent gets, as its first snapshot, the lines as they are
-- now (what `linesOf` gives): every line not struck out, a computed line giving way
-- to the batch cooker's correction of it. Keyed like `lineKey`, accents aside.
UPDATE "shopping_lists" sl
SET "sent_lines" = COALESCE((
  SELECT jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
      'name', i."name",
      'qty', COALESCE(i."qty", 0),
      'unit', COALESCE(i."unit", ''),
      'aisle', i."aisle",
      'edited', i."edited",
      -- A correction keeps the optional badge of the computed line it overrides.
      'optional', CASE WHEN i."optional" OR EXISTS (
          SELECT 1 FROM "shopping_items" c
          WHERE c."shopping_list_id" = sl."id" AND NOT c."edited" AND c."optional"
            AND lower(c."name") = lower(i."name")
            AND lower(COALESCE(c."unit", '')) = lower(COALESCE(i."unit", ''))
        ) THEN true END
    )) ORDER BY i."aisle", i."name")
  FROM "shopping_items" i
  WHERE i."shopping_list_id" = sl."id"
    AND NOT i."removed"
    AND (i."edited" OR NOT EXISTS (
      SELECT 1 FROM "shopping_items" e
      WHERE e."shopping_list_id" = sl."id" AND e."edited"
        AND lower(e."name") = lower(i."name")
        AND lower(COALESCE(e."unit", '')) = lower(COALESCE(i."unit", ''))
    ))
), '[]'::jsonb)
WHERE sl."version" > 0;

-- The client's marks answer the version they hold; the batch cooker now sees them
-- from the first tick (a mark on a line whose quantity changed still falls).
UPDATE "shopping_lists"
SET "marks_version" = "version",
    "marks_updated_at" = "final_received_at"
WHERE "version" > 0 AND "client_marks" <> '[]'::jsonb;
