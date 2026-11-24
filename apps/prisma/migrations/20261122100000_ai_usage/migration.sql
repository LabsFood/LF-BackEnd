-- Budget IA (DAT import de recettes, 6 bis): every call to an AI provider, and the
-- alerts already sent. Additive and replayable.
CREATE TABLE IF NOT EXISTS "ai_usage" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "poste" VARCHAR(32) NOT NULL,
  "feature" VARCHAR(48) NOT NULL,
  "tags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "provider" VARCHAR(16) NOT NULL,
  "model" VARCHAR(64) NOT NULL,
  "chef_profile_id" UUID,
  "attempt" SMALLINT NOT NULL DEFAULT 1,
  "input_tokens" INTEGER NOT NULL DEFAULT 0,
  "output_tokens" INTEGER NOT NULL DEFAULT 0,
  "pages" INTEGER NOT NULL DEFAULT 0,
  "cost_micro_eur" INTEGER NOT NULL DEFAULT 0,
  "duration_ms" INTEGER NOT NULL DEFAULT 0,
  "outcome" VARCHAR(24) NOT NULL,
  "error" VARCHAR(500),
  "request_id" VARCHAR(64),
  CONSTRAINT "ai_usage_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "idx_ai_usage_created_at" ON "ai_usage" ("created_at");
CREATE INDEX IF NOT EXISTS "idx_ai_usage_poste_created_at" ON "ai_usage" ("poste", "created_at");
CREATE INDEX IF NOT EXISTS "idx_ai_usage_chef_profile_created_at" ON "ai_usage" ("chef_profile_id", "created_at");

CREATE TABLE IF NOT EXISTS "ai_budget_alerts" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "scope" VARCHAR(32) NOT NULL,
  "period" VARCHAR(16) NOT NULL,
  "period_key" VARCHAR(10) NOT NULL,
  "threshold" SMALLINT NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ai_budget_alerts_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "uq_ai_budget_alerts" ON "ai_budget_alerts" ("scope", "period", "period_key", "threshold");
