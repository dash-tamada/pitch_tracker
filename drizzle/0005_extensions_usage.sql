-- Supabase installs pg_trgm in the "extensions" schema. Search path alone is not enough:
-- the runtime role also needs USAGE on that schema, otherwise creator matching and search
-- (similarity(), the % operator) fail with "permission denied for schema extensions".
-- No-op on plain PostgreSQL, where the extension lives in public.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'extensions') THEN
    GRANT USAGE ON SCHEMA extensions TO pitch_app;
  END IF;
END $$;
