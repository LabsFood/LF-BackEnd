-- Removes the "Notre Concept" CMS page table.
--
-- The CMS module was added by mistake at the start of the project. No frontend
-- ever read `GET /content/concept`, and on DEV the table held only seed rows (the
-- default page and 10 demo pages). Dropping the table drops its unique index and
-- its foreign key to `users` with it. The default copy remains in git history.
DROP TABLE IF EXISTS "cms_pages";
