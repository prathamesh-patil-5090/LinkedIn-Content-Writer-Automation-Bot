-- CreateTable
CREATE TABLE IF NOT EXISTS "source_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "source" TEXT NOT NULL DEFAULT 'rss',
    "project" TEXT,
    "event_type" TEXT NOT NULL DEFAULT 'story',
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "link" TEXT,
    "external_id" TEXT,
    "payload_json" JSONB,
    "problem" TEXT,
    "decision" TEXT,
    "solution" TEXT,
    "impact" TEXT,
    "technical_context" TEXT,
    "occurred_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "source_events_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "source_events_source_external_id_key" ON "source_events"("source", "external_id");
CREATE INDEX IF NOT EXISTS "source_events_created_at_idx" ON "source_events"("created_at");
CREATE INDEX IF NOT EXISTS "source_events_source_idx" ON "source_events"("source");

CREATE TABLE IF NOT EXISTS "content_opportunities" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "source_event_id" UUID,
    "run_id" UUID,
    "title" TEXT NOT NULL,
    "link" TEXT,
    "pillar" TEXT NOT NULL DEFAULT 'engineering',
    "format" TEXT,
    "content_score" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "scores_json" JSONB,
    "angles_json" JSONB,
    "hooks_json" JSONB,
    "selected_angle" TEXT,
    "selected_hook" TEXT,
    "status" TEXT NOT NULL DEFAULT 'scored',
    "reject_reasons" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "content_opportunities_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "content_opportunities_status_idx" ON "content_opportunities"("status");
CREATE INDEX IF NOT EXISTS "content_opportunities_pillar_idx" ON "content_opportunities"("pillar");
CREATE INDEX IF NOT EXISTS "content_opportunities_content_score_idx" ON "content_opportunities"("content_score");

CREATE TABLE IF NOT EXISTS "content_draft_meta" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "draft_id" UUID NOT NULL,
    "run_id" UUID NOT NULL,
    "pillar" TEXT,
    "format" TEXT,
    "content_score" DOUBLE PRECISION,
    "quality_score" DOUBLE PRECISION,
    "authenticity_score" DOUBLE PRECISION,
    "ai_genericness_score" DOUBLE PRECISION,
    "repetition_score" DOUBLE PRECISION,
    "diversity_score" DOUBLE PRECISION,
    "scores_json" JSONB,
    "decision" TEXT,
    "decision_reasons" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "decision_json" JSONB,
    "selected_angle" TEXT,
    "selected_hook" TEXT,
    "prompt_versions" JSONB,
    "regeneration_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "content_draft_meta_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "content_draft_meta_draft_id_key" ON "content_draft_meta"("draft_id");
CREATE INDEX IF NOT EXISTS "content_draft_meta_run_id_idx" ON "content_draft_meta"("run_id");
CREATE INDEX IF NOT EXISTS "content_draft_meta_decision_idx" ON "content_draft_meta"("decision");
CREATE INDEX IF NOT EXISTS "content_draft_meta_pillar_idx" ON "content_draft_meta"("pillar");

CREATE TABLE IF NOT EXISTS "writing_profiles" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "version" INTEGER NOT NULL DEFAULT 1,
    "profile_json" JSONB NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "writing_profiles_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "writing_profiles_is_active_idx" ON "writing_profiles"("is_active");

CREATE TABLE IF NOT EXISTS "published_post_performance" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "run_id" UUID NOT NULL,
    "draft_id" UUID,
    "linkedin_post_urn" TEXT,
    "pillar" TEXT,
    "format" TEXT,
    "hook" TEXT,
    "content_score" DOUBLE PRECISION,
    "quality_score" DOUBLE PRECISION,
    "impressions" INTEGER NOT NULL DEFAULT 0,
    "reactions" INTEGER NOT NULL DEFAULT 0,
    "comments" INTEGER NOT NULL DEFAULT 0,
    "reposts" INTEGER NOT NULL DEFAULT 0,
    "clicks" INTEGER NOT NULL DEFAULT 0,
    "profile_views" INTEGER NOT NULL DEFAULT 0,
    "followers_gained" INTEGER NOT NULL DEFAULT 0,
    "published_at" TIMESTAMP(3),
    "metrics_json" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "published_post_performance_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "published_post_performance_run_id_key" ON "published_post_performance"("run_id");
CREATE INDEX IF NOT EXISTS "published_post_performance_pillar_idx" ON "published_post_performance"("pillar");
CREATE INDEX IF NOT EXISTS "published_post_performance_published_at_idx" ON "published_post_performance"("published_at");

DO $$ BEGIN
  ALTER TABLE "content_opportunities"
    ADD CONSTRAINT "content_opportunities_source_event_id_fkey"
    FOREIGN KEY ("source_event_id") REFERENCES "source_events"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "content_draft_meta"
    ADD CONSTRAINT "content_draft_meta_draft_id_fkey"
    FOREIGN KEY ("draft_id") REFERENCES "drafts"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
