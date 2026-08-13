-- CreateSchema
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "linkedin_connections" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "access_token" TEXT NOT NULL,
    "refresh_token" TEXT,
    "expires_at" TIMESTAMP(3),
    "person_urn" TEXT NOT NULL,
    "connected_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "linkedin_connections_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "voice_samples" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "source_url" TEXT,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "voice_samples_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "news_sources" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "rss_url" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "news_sources_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "runs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "triggered_by" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "collected_at" TIMESTAMP(3),
    "story_count" INTEGER,
    "winner_json" JSONB,
    "top_stories_json" JSONB,
    "error_message" TEXT,
    "published_at" TIMESTAMP(3),
    "linkedin_post_urn" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "runs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "drafts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "run_id" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "chosen_style" TEXT,
    "hook" TEXT,
    "post_text" TEXT,
    "image_prompt" TEXT,
    "image_url" TEXT,
    "hashtags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "source_title" TEXT,
    "source_link" TEXT,
    "three_drafts_json" JSONB,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "feedback" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "drafts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "pipeline_logs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "run_id" UUID NOT NULL,
    "step" TEXT NOT NULL,
    "input_excerpt" TEXT,
    "output_json" JSONB,
    "latency_ms" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "pipeline_logs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "settings" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Kolkata',
    "cron_enabled" BOOLEAN NOT NULL DEFAULT true,
    "telegram_chat_id" TEXT,
    "telegram_enabled" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "settings_pkey" PRIMARY KEY ("id")
);

-- Indexes / uniques
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");
CREATE UNIQUE INDEX "linkedin_connections_user_id_key" ON "linkedin_connections"("user_id");
CREATE INDEX "runs_status_idx" ON "runs"("status");
CREATE INDEX "runs_created_at_idx" ON "runs"("created_at");
CREATE UNIQUE INDEX "drafts_run_id_version_key" ON "drafts"("run_id", "version");
CREATE INDEX "drafts_run_id_status_idx" ON "drafts"("run_id", "status");
CREATE INDEX "pipeline_logs_run_id_idx" ON "pipeline_logs"("run_id");
CREATE UNIQUE INDEX "settings_user_id_key" ON "settings"("user_id");

-- FKs
ALTER TABLE "linkedin_connections" ADD CONSTRAINT "linkedin_connections_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "drafts" ADD CONSTRAINT "drafts_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "pipeline_logs" ADD CONSTRAINT "pipeline_logs_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "settings" ADD CONSTRAINT "settings_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
