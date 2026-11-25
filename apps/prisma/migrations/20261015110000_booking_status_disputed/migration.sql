-- A prestation in dispute (the web's "En litige"). Set and cleared by an admin
-- until the litiges module exists, then driven by it. Postgres cannot drop an enum
-- value without recreating the type, so this one stays.
ALTER TYPE "booking_status" ADD VALUE IF NOT EXISTS 'disputed';
