-- Hardening for managed PostgreSQL (Supabase) — also safe on plain PostgreSQL.
--
-- Why: Supabase's Data API (PostgREST/GraphQL) exposes the public schema to the roles
-- anon / authenticated / service_role, and its default privileges GRANT those roles full
-- access to every new table. This application never uses the Data API: the server connects
-- as `pitch_app` and enforces all authorization itself. So:
--   1. revoke every API role's access to our tables, sequences and functions (now and future)
--   2. enable Row Level Security on every table, with a policy that admits only `pitch_app`
--      (deny-by-default for any other non-owner role, even if a grant is added by mistake)
--   3. pin search_path on our trigger functions (prevents search_path hijacking)

CREATE OR REPLACE FUNCTION public.forbid_mutation() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  RAISE EXCEPTION 'IMMUTABLE_RECORD: % on % is not permitted', TG_OP, TG_TABLE_NAME
    USING ERRCODE = 'insufficient_privilege';
END;
$$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.document_versions_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'IMMUTABLE_RECORD: DELETE on document_versions is not permitted'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF (to_jsonb(NEW) - 'scan_status') IS DISTINCT FROM (to_jsonb(OLD) - 'scan_status')
     OR OLD.scan_status <> 'PENDING' THEN
    RAISE EXCEPTION 'IMMUTABLE_RECORD: document_versions may only change scan_status from PENDING'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.workflow_config_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE def_id uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN def_id := OLD.definition_id; ELSE def_id := NEW.definition_id; END IF;
  IF EXISTS (SELECT 1 FROM public.pitches WHERE workflow_definition_id = def_id)
     OR (TG_OP = 'UPDATE' AND EXISTS (SELECT 1 FROM public.pitches WHERE workflow_definition_id = OLD.definition_id)) THEN
    RAISE EXCEPTION 'WORKFLOW_IN_USE: definition % is used by pitches; publish a new version', def_id
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.touch_updated_at() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;
--> statement-breakpoint

REVOKE ALL ON FUNCTION public.forbid_mutation(), public.document_versions_guard(),
  public.workflow_config_guard(), public.touch_updated_at() FROM PUBLIC;
--> statement-breakpoint

DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA public FROM %I', r);
      EXECUTE format('REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM %I', r);
      EXECUTE format('REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM %I', r);
      EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM %I', r);
      EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM %I', r);
      EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM %I', r);
    END IF;
  END LOOP;
END $$;
--> statement-breakpoint

DO $$
DECLARE t text;
BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS app_server_only ON public.%I', t);
    -- The application server is the only intended client; it enforces per-user access itself.
    EXECUTE format('CREATE POLICY app_server_only ON public.%I AS PERMISSIVE FOR ALL TO pitch_app USING (true) WITH CHECK (true)', t);
  END LOOP;
END $$;
--> statement-breakpoint

-- pg_trgm lives in "extensions" on Supabase; the app role needs it on its search path for similarity search.
ALTER ROLE pitch_app SET search_path = public, extensions;
