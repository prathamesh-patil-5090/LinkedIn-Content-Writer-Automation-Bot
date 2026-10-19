-- Move LDP settings off the generic "settings" name (often used by other apps as key/value).
DO $$
BEGIN
  IF to_regclass('public.user_settings') IS NOT NULL THEN
    NULL;
  ELSIF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'settings'
      AND column_name = 'user_id'
  ) THEN
    ALTER TABLE "settings" RENAME TO "user_settings";
  ELSIF to_regclass('public.settings_foreign_app') IS NOT NULL THEN
    ALTER TABLE "settings_foreign_app" RENAME TO "user_settings";
  ELSE
    CREATE TABLE "user_settings" (
      "id" UUID NOT NULL DEFAULT gen_random_uuid(),
      "user_id" UUID NOT NULL,
      "timezone" TEXT NOT NULL DEFAULT 'Asia/Kolkata',
      "cron_enabled" BOOLEAN NOT NULL DEFAULT true,
      "telegram_chat_id" TEXT,
      "telegram_enabled" BOOLEAN NOT NULL DEFAULT false,
      CONSTRAINT "user_settings_pkey" PRIMARY KEY ("id")
    );
    CREATE UNIQUE INDEX "user_settings_user_id_key" ON "user_settings"("user_id");
    ALTER TABLE "user_settings"
      ADD CONSTRAINT "user_settings_user_id_fkey"
      FOREIGN KEY ("user_id") REFERENCES "users"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- Normalize constraint/index names when we renamed an existing table.
DO $$
BEGIN
  IF to_regclass('public.user_settings') IS NULL THEN
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'settings_pkey' AND conrelid = 'public.user_settings'::regclass) THEN
    ALTER TABLE "user_settings" RENAME CONSTRAINT "settings_pkey" TO "user_settings_pkey";
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'settings_user_id_fkey' AND conrelid = 'public.user_settings'::regclass) THEN
    ALTER TABLE "user_settings" RENAME CONSTRAINT "settings_user_id_fkey" TO "user_settings_user_id_fkey";
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'settings_foreign_app_pkey' AND conrelid = 'public.user_settings'::regclass) THEN
    ALTER TABLE "user_settings" RENAME CONSTRAINT "settings_foreign_app_pkey" TO "user_settings_pkey";
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'settings_foreign_app_user_id_fkey' AND conrelid = 'public.user_settings'::regclass) THEN
    ALTER TABLE "user_settings" RENAME CONSTRAINT "settings_foreign_app_user_id_fkey" TO "user_settings_user_id_fkey";
  END IF;

  IF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'settings_user_id_key') THEN
    ALTER INDEX "settings_user_id_key" RENAME TO "user_settings_user_id_key";
  END IF;
  IF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'settings_foreign_app_user_id_key') THEN
    ALTER INDEX "settings_foreign_app_user_id_key" RENAME TO "user_settings_user_id_key";
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'user_settings_user_id_fkey'
      AND conrelid = 'public.user_settings'::regclass
  ) AND EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'user_settings' AND column_name = 'user_id'
  ) THEN
    BEGIN
      ALTER TABLE "user_settings"
        ADD CONSTRAINT "user_settings_user_id_fkey"
        FOREIGN KEY ("user_id") REFERENCES "users"("id")
        ON DELETE CASCADE ON UPDATE CASCADE;
    EXCEPTION WHEN duplicate_object THEN
      NULL;
    END;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public' AND indexname = 'user_settings_user_id_key'
  ) THEN
    CREATE UNIQUE INDEX "user_settings_user_id_key" ON "user_settings"("user_id");
  END IF;
END $$;
