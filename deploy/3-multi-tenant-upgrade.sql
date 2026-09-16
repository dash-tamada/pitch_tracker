-- ════════════════════════════════════════════════════════════════════════════
-- Pitch Tracker — production upgrade to multi-tenant (migration 0006_multi_tenant)
--
-- BEFORE RUNNING:
--   1. Supabase → Database → Backups: confirm today's backup exists (or take a manual pg_dump).
--   2. Run in the SQL editor of project emtadepabamemdxmumyc as the default "postgres" user.
--   3. Deploy the matching application version immediately after (old app code cannot read the new schema).
--
-- What it does: creates companies/plans/subscriptions, moves ALL existing data into company TAM
-- "Tamada Media" (pitch codes unchanged), renames the SUPER_ADMIN role to COMPANY_ADMIN inside TAM,
-- replaces the single-tenant RLS policy with per-company isolation, creates the pitch_platform role
-- (no password yet — set it with npm run setup:local) and records the migration for Drizzle.
-- It runs as ONE transaction: if any statement fails, nothing is changed.
-- File hash (must match drizzle/0006_multi_tenant.sql): daa69355a68268d8a604856e854b09b63378e3a5fd9e402bdcb3ccb29723248c
-- ════════════════════════════════════════════════════════════════════════════
BEGIN;

DO $guard$
BEGIN
  IF (SELECT count(*) FROM drizzle.__drizzle_migrations) <> 6 THEN
    RAISE EXCEPTION 'Expected exactly 6 applied migrations (0000–0005). Stop and check the database.';
  END IF;
  IF EXISTS (SELECT 1 FROM drizzle.__drizzle_migrations WHERE hash = 'daa69355a68268d8a604856e854b09b63378e3a5fd9e402bdcb3ccb29723248c') THEN
    RAISE EXCEPTION '0006_multi_tenant is already applied.';
  END IF;
END $guard$;

-- ════════════════════════════════════════════════════════════════════════════
-- 0006  Multi-tenant SaaS: companies, tenant ownership, row-level isolation.
--
-- Isolation model (docs/SAAS_MULTI_TENANT_PLAN.md §0):
--  * every company-owned row carries company_id
--  * pitch_app (company work) sees/writes only rows whose company_id equals the
--    transaction-local setting app.company_id, which only the server sets from the session
--  * company_id defaults to that setting, so INSERTs cannot target another company
--  * composite foreign keys (company_id, x_id) make cross-company links impossible
--  * pitch_platform (identity + platform admin) has NO grants on customer content
--
-- Existing single-company data (if any) becomes company TAM "Tamada Media";
-- the old SUPER_ADMIN role becomes COMPANY_ADMIN inside that company.
-- Runs in one transaction (Drizzle migrator): any failure applies nothing.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. Roles ─────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pitch_app') THEN
    RAISE EXCEPTION 'Role pitch_app must exist before running migrations';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pitch_platform') THEN
    CREATE ROLE pitch_platform NOLOGIN NOINHERIT;   -- password + LOGIN are set by the operator (npm run setup:local)
  END IF;
END $$;

ALTER ROLE pitch_platform SET search_path = public, extensions;

GRANT USAGE ON SCHEMA public TO pitch_platform;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'extensions') THEN GRANT USAGE ON SCHEMA extensions TO pitch_platform; END IF;
END $$;


-- ── 2. Types ─────────────────────────────────────────────────────────────────
CREATE TYPE public.company_status AS ENUM ('PENDING_SETUP', 'TRIAL', 'ACTIVE', 'SUSPENDED', 'EXPIRED', 'ARCHIVED');

CREATE TYPE public.subscription_status AS ENUM ('TRIAL', 'ACTIVE', 'PAST_DUE', 'SUSPENDED', 'EXPIRED', 'CANCELLED');

CREATE TYPE public.account_scope AS ENUM ('PLATFORM', 'COMPANY');

CREATE TYPE public.permission_scope AS ENUM ('PLATFORM', 'COMPANY');

ALTER TYPE public.user_status ADD VALUE IF NOT EXISTS 'INVITED';

ALTER TYPE public.user_status ADD VALUE IF NOT EXISTS 'SUSPENDED';


-- ── 3. Tenant context helper ─────────────────────────────────────────────────
CREATE FUNCTION public.app_company_id() RETURNS uuid
LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT nullif(current_setting('app.company_id', true), '')::uuid
$$;

REVOKE ALL ON FUNCTION public.app_company_id() FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.app_company_id() TO pitch_app, pitch_platform;


-- ── 4. Platform tables ───────────────────────────────────────────────────────
CREATE TABLE public.companies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code varchar(12) NOT NULL,
  name varchar(160) NOT NULL,
  legal_name varchar(200),
  logo_key text,
  favicon_key text,
  brand_primary_color varchar(7),
  website varchar(500),
  industry varchar(120),
  country varchar(80),
  state varchar(80),
  city varchar(80),
  address text,
  contact_person varchar(120),
  contact_phone varchar(20),
  primary_email varchar(254),
  pitch_code_prefix varchar(12),
  status public.company_status NOT NULL DEFAULT 'PENDING_SETUP',
  status_reason varchar(300),
  retention_days integer NOT NULL DEFAULT 365,
  setup_completed_at timestamptz,
  suspended_at timestamptz,
  archived_at timestamptz,
  created_by_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT companies_code_ck CHECK (code ~ '^[A-Z][A-Z0-9]{1,11}$'),
  CONSTRAINT companies_color_ck CHECK (brand_primary_color IS NULL OR brand_primary_color ~ '^#[0-9A-Fa-f]{6}$'),
  CONSTRAINT companies_prefix_ck CHECK (pitch_code_prefix IS NULL OR pitch_code_prefix ~ '^[A-Z][A-Z0-9]{1,11}$'),
  CONSTRAINT companies_retention_ck CHECK (retention_days BETWEEN 30 AND 3650)
);

CREATE UNIQUE INDEX companies_code_uq ON public.companies (code);

CREATE TABLE public.plans (
  key varchar(40) PRIMARY KEY,
  name varchar(80) NOT NULL,
  description text,
  -- e.g. {"max_users": 10, "storage_bytes": 107374182400, "max_file_bytes": 52428800, "max_pitches": null}
  -- null or missing limit = unlimited. Never hard-coded in application code.
  limits jsonb NOT NULL DEFAULT '{}'::jsonb,
  active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id),
  plan_key varchar(40) NOT NULL REFERENCES public.plans(key),
  status public.subscription_status NOT NULL DEFAULT 'TRIAL',
  starts_on date NOT NULL DEFAULT CURRENT_DATE,
  ends_on date,
  limit_overrides jsonb NOT NULL DEFAULT '{}'::jsonb,
  external_provider varchar(40),
  external_ref varchar(120),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT subscriptions_dates_ck CHECK (ends_on IS NULL OR ends_on >= starts_on)
);

CREATE UNIQUE INDEX subscriptions_company_uq ON public.subscriptions (company_id);

CREATE TABLE public.subscription_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id),
  event varchar(60) NOT NULL,
  before jsonb,
  after jsonb,
  actor_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX subscription_events_company_idx ON public.subscription_events (company_id, created_at);

CREATE TABLE public.usage_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id),
  period date NOT NULL,
  metric varchar(40) NOT NULL,
  value bigint NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX usage_records_uq ON public.usage_records (company_id, period, metric);

CREATE TABLE public.support_access_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id),
  platform_user_id uuid NOT NULL,
  reason varchar(500) NOT NULL,
  starts_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT support_access_window_ck CHECK (expires_at > starts_at AND expires_at <= starts_at + interval '4 hours'),
  CONSTRAINT support_access_reason_ck CHECK (char_length(btrim(reason)) >= 10)
);

CREATE INDEX support_access_grants_company_idx ON public.support_access_grants (company_id, expires_at);

CREATE TABLE public.company_email_domains (
  company_id uuid NOT NULL REFERENCES public.companies(id),
  domain varchar(253) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id, domain),
  CONSTRAINT company_email_domains_format_ck CHECK (domain ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$')
);

CREATE TABLE public.company_allowed_emails (
  company_id uuid NOT NULL DEFAULT public.app_company_id() REFERENCES public.companies(id),
  email varchar(254) NOT NULL,
  reason varchar(300),
  approved_by_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id, email),
  CONSTRAINT company_allowed_emails_lower_ck CHECK (email = lower(email))
);

CREATE TABLE public.platform_catalog (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name varchar(120) NOT NULL,
  kind varchar(40) NOT NULL DEFAULT 'OTT',
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX platform_catalog_name_uq ON public.platform_catalog (lower(name));


-- ── 5. Tenant #1 from existing single-company data ───────────────────────────
-- pitch_code_prefix 'PT' keeps existing pitch codes (PT-2026-000001…) continuous for this company.
INSERT INTO public.companies (code, name, pitch_code_prefix, status, setup_completed_at)
SELECT 'TAM', 'Tamada Media', 'PT', 'ACTIVE', now()
WHERE EXISTS (SELECT 1 FROM public.users) OR EXISTS (SELECT 1 FROM public.roles) OR EXISTS (SELECT 1 FROM public.pitches);


-- Default plans (limits are data, editable by the Super Admin; null = unlimited) and tenant #1's subscription.
INSERT INTO public.plans (key, name, sort_order, limits) VALUES
  ('STARTER', 'Starter', 1, '{"max_users": 10, "max_pitches": 500, "storage_bytes": 10737418240, "max_file_bytes": 26214400}'),
  ('PROFESSIONAL', 'Professional', 2, '{"max_users": 50, "max_pitches": 5000, "storage_bytes": 107374182400, "max_file_bytes": 52428800}'),
  ('ENTERPRISE', 'Enterprise', 3, '{"max_users": null, "max_pitches": null, "storage_bytes": 1099511627776, "max_file_bytes": 104857600}')
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.subscriptions (company_id, plan_key, status)
SELECT id, 'ENTERPRISE', 'ACTIVE' FROM public.companies WHERE code = 'TAM';

-- Tenant #1 email policy: the company domain, plus every address already in use (so nobody is locked out of re-invites).
INSERT INTO public.company_email_domains (company_id, domain)
SELECT c.id, 'tamadamedia.com' FROM public.companies c WHERE c.code = 'TAM';

INSERT INTO public.company_allowed_emails (company_id, email, reason)
SELECT c.id, u.email, 'Existing account at multi-tenant migration'
  FROM public.companies c CROSS JOIN public.users u
 WHERE c.code = 'TAM' AND split_part(u.email, '@', 2) <> 'tamadamedia.com';


-- ── 6. Users: scope + company + employee profile ─────────────────────────────
ALTER TABLE public.users
  ADD COLUMN company_id uuid REFERENCES public.companies(id),
  ADD COLUMN scope public.account_scope NOT NULL DEFAULT 'COMPANY',
  ADD COLUMN first_name varchar(60),
  ADD COLUMN last_name varchar(60),
  ADD COLUMN mobile_e164 varchar(16),
  ADD COLUMN profile_image_key text,
  ADD COLUMN department varchar(120),
  ADD COLUMN designation varchar(120),
  ADD COLUMN employee_code varchar(40),
  ADD COLUMN joining_date date,
  ADD COLUMN disabled_at timestamptz;

ALTER TABLE public.users DISABLE TRIGGER USER;

UPDATE public.users SET company_id = (SELECT id FROM public.companies WHERE code = 'TAM');

ALTER TABLE public.users ENABLE TRIGGER USER;

ALTER TABLE public.users ALTER COLUMN company_id SET DEFAULT public.app_company_id();

ALTER TABLE public.users ADD CONSTRAINT users_scope_company_ck CHECK ((scope = 'PLATFORM') = (company_id IS NULL));

ALTER TABLE public.users ADD CONSTRAINT users_mobile_format_ck CHECK (mobile_e164 IS NULL OR mobile_e164 ~ '^\+[1-9][0-9]{7,14}$');

CREATE UNIQUE INDEX users_company_id_id_uq ON public.users (company_id, id);

CREATE UNIQUE INDEX users_company_employee_code_uq ON public.users (company_id, employee_code) WHERE employee_code IS NOT NULL;

CREATE INDEX users_company_status_idx ON public.users (company_id, status);

ALTER TABLE public.companies ADD CONSTRAINT companies_created_by_fk FOREIGN KEY (created_by_id) REFERENCES public.users(id);

ALTER TABLE public.support_access_grants ADD CONSTRAINT support_access_grants_user_fk FOREIGN KEY (platform_user_id) REFERENCES public.users(id);


-- ── 7. company_id on every company-owned table, backfilled to tenant #1 ─────
DO $$
DECLARE
  t text;
  tam uuid := (SELECT id FROM public.companies WHERE code = 'TAM');
  tenant_tables text[] := ARRAY[
    'roles','role_permissions','user_roles','lookup_values','rating_categories','system_settings',
    'workflow_definitions','workflow_stages','workflow_transitions',
    'creators','creator_projects','pitches','pitch_participants','workflow_events',
    'documents','document_versions','document_scan_results','pitch_images','document_access_logs',
    'ratings','rating_scores','platforms','platform_contacts','platform_pitches','platform_responses','follow_ups',
    'development_projects','development_updates','production_projects','production_updates',
    'notifications','job_outbox','saved_filters','pitch_code_counters','upload_intents','audit_logs'];
BEGIN
  FOREACH t IN ARRAY tenant_tables LOOP
    EXECUTE format('ALTER TABLE public.%I ADD COLUMN company_id uuid REFERENCES public.companies(id)', t);
    EXECUTE format('ALTER TABLE public.%I DISABLE TRIGGER USER', t);      -- immutability/touch triggers must not fire on backfill
    EXECUTE format('UPDATE public.%I SET company_id = $1', t) USING tam;
    EXECUTE format('ALTER TABLE public.%I ENABLE TRIGGER USER', t);
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN company_id SET DEFAULT public.app_company_id()', t);
    IF t <> 'audit_logs' THEN                                            -- platform audit events have no company
      EXECUTE format('ALTER TABLE public.%I ALTER COLUMN company_id SET NOT NULL', t);
    END IF;
  END LOOP;
END $$;

-- audit rows written before this migration with no actor company stay with tenant #1 (company events)
-- password reset tokens / sessions are identity data scoped through users (see policies).

-- ── 8. Role data migration: SUPER_ADMIN becomes COMPANY_ADMIN inside its company ──
ALTER TABLE public.roles DISABLE TRIGGER USER;

UPDATE public.roles SET key = 'COMPANY_ADMIN', name = 'Company Admin' WHERE key = 'SUPER_ADMIN';

ALTER TABLE public.roles ENABLE TRIGGER USER;

ALTER TABLE public.workflow_transitions DISABLE TRIGGER USER;

UPDATE public.workflow_transitions
   SET allowed_role_keys = array_replace(allowed_role_keys, 'SUPER_ADMIN', 'COMPANY_ADMIN'),
       recipient_role_keys = array_replace(recipient_role_keys, 'SUPER_ADMIN', 'COMPANY_ADMIN')
 WHERE 'SUPER_ADMIN' = ANY (coalesce(allowed_role_keys, '{}') || coalesce(recipient_role_keys, '{}'));

ALTER TABLE public.workflow_transitions ENABLE TRIGGER USER;


-- ── 9. Per-company uniqueness (global where it must stay global) ────────────
ALTER TABLE public.pitches ALTER COLUMN pitch_code TYPE varchar(32);

DROP INDEX public.pitches_code_uq;

CREATE UNIQUE INDEX pitches_company_code_uq ON public.pitches (company_id, pitch_code);

DROP INDEX public.creators_mobile_uq;

CREATE UNIQUE INDEX creators_company_mobile_uq ON public.creators (company_id, mobile_e164) WHERE mobile_e164 IS NOT NULL;

DROP INDEX public.creators_email_uq;

CREATE UNIQUE INDEX creators_company_email_uq ON public.creators (company_id, email_normalized) WHERE email_normalized IS NOT NULL;

DROP INDEX public.roles_key_uq;

CREATE UNIQUE INDEX roles_company_key_uq ON public.roles (company_id, key);

DROP INDEX public.rating_categories_key_uq;

CREATE UNIQUE INDEX rating_categories_company_key_uq ON public.rating_categories (company_id, key);

DROP INDEX public.lookup_type_key_uq;

CREATE UNIQUE INDEX lookup_company_type_key_uq ON public.lookup_values (company_id, type, key);

DROP INDEX public.workflow_def_version_uq;

CREATE UNIQUE INDEX workflow_def_company_version_uq ON public.workflow_definitions (company_id, name, version);

DROP INDEX public.workflow_def_one_active_uq;

CREATE UNIQUE INDEX workflow_def_company_one_active_uq ON public.workflow_definitions (company_id) WHERE is_active = true;

DROP INDEX public.platforms_name_uq;

CREATE UNIQUE INDEX platforms_company_name_uq ON public.platforms (company_id, lower(name));

ALTER TABLE public.platforms ADD COLUMN catalog_id uuid REFERENCES public.platform_catalog(id);

ALTER TABLE public.system_settings DROP CONSTRAINT system_settings_pkey;

ALTER TABLE public.system_settings ADD PRIMARY KEY (company_id, key);

ALTER TABLE public.pitch_code_counters DROP CONSTRAINT pitch_code_counters_pkey;

ALTER TABLE public.pitch_code_counters ADD PRIMARY KEY (company_id, year);


-- Global platform master list, seeded from tenant #1's platforms when present.
INSERT INTO public.platform_catalog (name, kind)
SELECT DISTINCT ON (lower(name)) name, kind FROM public.platforms ORDER BY lower(name), created_at;

ALTER TABLE public.platforms DISABLE TRIGGER USER;

UPDATE public.platforms p SET catalog_id = c.id FROM public.platform_catalog c WHERE lower(c.name) = lower(p.name);

ALTER TABLE public.platforms ENABLE TRIGGER USER;


-- ── 10. Composite keys: every relationship stays inside one company ─────────
DO $$
DECLARE
  t text;
  parents text[] := ARRAY['creators','pitches','documents','document_versions','platforms','platform_contacts','platform_pitches',
    'development_projects','production_projects','ratings','rating_categories','roles','workflow_definitions','workflow_events'];
BEGIN
  FOREACH t IN ARRAY parents LOOP
    EXECUTE format('CREATE UNIQUE INDEX %I ON public.%I (company_id, id)', t || '_company_id_id_uq', t);
    EXECUTE format('ALTER TABLE public.%I ADD CONSTRAINT %I UNIQUE USING INDEX %I', t, t || '_company_id_id_uk', t || '_company_id_id_uq');
  END LOOP;
END $$;

ALTER TABLE public.users ADD CONSTRAINT users_company_id_id_uk UNIQUE USING INDEX users_company_id_id_uq;

DO $$
DECLARE
  spec text;
  child text; col text; parent text; old_name text; deferrable_clause text;
  specs text[] := ARRAY[
    'creator_projects.creator_id.creators', 'creator_projects.created_by_id.users',
    'creators.created_by_id.users',
    'development_projects.pitch_id.pitches', 'development_projects.platform_pitch_id.platform_pitches', 'development_projects.owner_id.users',
    'development_updates.development_project_id.development_projects', 'development_updates.author_id.users',
    'document_access_logs.document_version_id.document_versions', 'document_access_logs.pitch_id.pitches', 'document_access_logs.user_id.users',
    'document_scan_results.document_version_id.document_versions',
    'document_versions.document_id.documents', 'document_versions.uploaded_by_id.users',
    'documents.pitch_id.pitches', 'documents.created_by_id.users', 'documents.current_version_id.document_versions',
    'follow_ups.platform_pitch_id.platform_pitches', 'follow_ups.assignee_id.users', 'follow_ups.created_by_id.users',
    'notifications.user_id.users', 'notifications.pitch_id.pitches',
    'pitch_images.pitch_id.pitches', 'pitch_images.uploaded_by_id.users',
    'pitch_participants.pitch_id.pitches', 'pitch_participants.user_id.users', 'pitch_participants.granted_by_id.users',
    'pitches.creator_id.creators', 'pitches.created_by_id.users', 'pitches.workflow_definition_id.workflow_definitions',
    'pitches.current_owner_id.users', 'pitches.archived_by_id.users',
    'platform_contacts.platform_id.platforms',
    'platform_pitches.pitch_id.pitches', 'platform_pitches.platform_id.platforms', 'platform_pitches.pitched_by_id.users',
    'platform_pitches.contact_id.platform_contacts', 'platform_pitches.script_version_id.document_versions', 'platform_pitches.deck_version_id.document_versions',
    'platform_responses.platform_pitch_id.platform_pitches', 'platform_responses.recorded_by_id.users',
    'production_projects.pitch_id.pitches', 'production_projects.owner_id.users', 'production_projects.platform_id.platforms',
    'production_updates.production_project_id.production_projects', 'production_updates.author_id.users',
    'rating_scores.rating_id.ratings', 'rating_scores.category_id.rating_categories',
    'ratings.creator_id.creators', 'ratings.pitch_id.pitches', 'ratings.reviewer_id.users', 'ratings.workflow_event_id.workflow_events',
    'role_permissions.role_id.roles',
    'saved_filters.user_id.users',
    'system_settings.updated_by_id.users',
    'upload_intents.created_by_id.users', 'upload_intents.creator_id.creators', 'upload_intents.document_id.documents', 'upload_intents.pitch_id.pitches',
    'user_roles.user_id.users', 'user_roles.role_id.roles', 'user_roles.granted_by_id.users',
    'workflow_definitions.created_by_id.users',
    'workflow_events.pitch_id.pitches', 'workflow_events.actor_id.users', 'workflow_events.from_owner_id.users',
    'workflow_events.to_owner_id.users', 'workflow_events.platform_id.platforms',
    'workflow_stages.definition_id.workflow_definitions',
    'workflow_transitions.definition_id.workflow_definitions'];
BEGIN
  IF array_length(specs, 1) <> 70 THEN RAISE EXCEPTION 'expected 70 tenant relationships, got %', array_length(specs, 1); END IF;
  FOREACH spec IN ARRAY specs LOOP
    child := split_part(spec, '.', 1); col := split_part(spec, '.', 2); parent := split_part(spec, '.', 3);
    SELECT c.conname INTO old_name FROM pg_constraint c
     WHERE c.conrelid = format('public.%I', child)::regclass AND c.contype = 'f'
       AND c.conkey = ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid = c.conrelid AND attname = col)]::smallint[];
    IF old_name IS NULL THEN RAISE EXCEPTION 'foreign key %.% not found', child, col; END IF;
    deferrable_clause := CASE WHEN spec = 'documents.current_version_id.document_versions' THEN ' DEFERRABLE INITIALLY DEFERRED' ELSE '' END;
    EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT %I', child, old_name);
    EXECUTE format('ALTER TABLE public.%I ADD CONSTRAINT %I FOREIGN KEY (company_id, %I) REFERENCES public.%I (company_id, id)%s',
                   child, left(child || '_' || col || '_tenant_fk', 63), col, parent, deferrable_clause);
  END LOOP;
END $$;


-- ── 11. Company-leading indexes for tenant-scoped queries ───────────────────
DROP INDEX public.pitches_stage_idx;

CREATE INDEX pitches_company_stage_idx ON public.pitches (company_id, current_stage_key, stage_entered_at);

DROP INDEX public.pitches_owner_idx;

CREATE INDEX pitches_company_owner_idx ON public.pitches (company_id, current_owner_id);

DROP INDEX public.pitches_creator_idx;

CREATE INDEX pitches_company_creator_idx ON public.pitches (company_id, creator_id);

DROP INDEX public.pitches_created_idx;

CREATE INDEX pitches_company_created_idx ON public.pitches (company_id, created_at);

DROP INDEX public.notifications_user_idx;

CREATE INDEX notifications_company_user_idx ON public.notifications (company_id, user_id, read_at, created_at);

DROP INDEX public.audit_logs_action_idx;

CREATE INDEX audit_logs_company_created_idx ON public.audit_logs (company_id, created_at);

CREATE INDEX audit_logs_company_action_idx ON public.audit_logs (company_id, action, created_at);

DROP INDEX public.workflow_events_action_idx;

CREATE INDEX workflow_events_company_action_idx ON public.workflow_events (company_id, action, created_at);

DROP INDEX public.platform_pitches_platform_status_idx;

CREATE INDEX platform_pitches_company_platform_status_idx ON public.platform_pitches (company_id, platform_id, current_status);

DROP INDEX public.follow_ups_due_open_idx;

CREATE INDEX follow_ups_company_due_open_idx ON public.follow_ups (company_id, due_on) WHERE completed_at IS NULL;

DROP INDEX public.job_outbox_pending_idx;

CREATE INDEX job_outbox_company_pending_idx ON public.job_outbox (company_id, run_after) WHERE status = 'PENDING';

CREATE INDEX creators_company_created_idx ON public.creators (company_id, created_at);


-- ── 12. Invitations ──────────────────────────────────────────────────────────
CREATE TABLE public.user_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL DEFAULT public.app_company_id() REFERENCES public.companies(id),
  user_id uuid NOT NULL,
  token_hash bytea NOT NULL,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  revoked_at timestamptz,
  invited_by_id uuid REFERENCES public.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT user_invitations_user_fk FOREIGN KEY (company_id, user_id) REFERENCES public.users (company_id, id)
);

CREATE UNIQUE INDEX user_invitations_token_uq ON public.user_invitations (token_hash);

CREATE INDEX user_invitations_user_idx ON public.user_invitations (company_id, user_id, created_at);


-- ── 13. Permission scopes: company roles can never hold platform permissions ─
ALTER TABLE public.permissions ADD COLUMN scope public.permission_scope NOT NULL DEFAULT 'COMPANY';

CREATE FUNCTION public.role_permission_scope_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.permissions p WHERE p.key = NEW.permission_key AND p.scope <> 'COMPANY') THEN
    RAISE EXCEPTION 'PLATFORM_PERMISSION: % cannot be granted to a company role', NEW.permission_key
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.role_permission_scope_guard() FROM PUBLIC;

CREATE TRIGGER role_permissions_scope_guard BEFORE INSERT OR UPDATE ON public.role_permissions
  FOR EACH ROW EXECUTE FUNCTION public.role_permission_scope_guard();

CREATE TRIGGER companies_touch_updated_at BEFORE UPDATE ON public.companies FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TRIGGER plans_touch_updated_at BEFORE UPDATE ON public.plans FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TRIGGER subscriptions_touch_updated_at BEFORE UPDATE ON public.subscriptions FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TRIGGER subscription_events_immutable BEFORE UPDATE OR DELETE ON public.subscription_events FOR EACH ROW EXECUTE FUNCTION public.forbid_mutation();


-- workflow_config_guard must look only at pitches of the same company (RLS already limits it for pitch_app;
-- the migrator/owner path is covered by definition ids being unique).

-- ── 14. Platform usage without content access ────────────────────────────────
CREATE FUNCTION public.platform_company_usage()
RETURNS TABLE (company_id uuid, users_total integer, users_active integer, users_invited integer, pitches integer, creators integer,
               documents integer, images integer, storage_bytes bigint, last_activity_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT c.id,
    (SELECT count(*)::int FROM public.users u WHERE u.company_id = c.id AND u.archived_at IS NULL),
    (SELECT count(*)::int FROM public.users u WHERE u.company_id = c.id AND u.archived_at IS NULL AND u.status = 'ACTIVE'),
    (SELECT count(*)::int FROM public.users u WHERE u.company_id = c.id AND u.archived_at IS NULL AND u.status::text = 'INVITED'),
    (SELECT count(*)::int FROM public.pitches p WHERE p.company_id = c.id AND p.archived_at IS NULL),
    (SELECT count(*)::int FROM public.creators x WHERE x.company_id = c.id AND x.archived_at IS NULL),
    (SELECT count(*)::int FROM public.document_versions v WHERE v.company_id = c.id),
    (SELECT count(*)::int FROM public.pitch_images i WHERE i.company_id = c.id),
    coalesce((SELECT sum(v.size_bytes) FROM public.document_versions v WHERE v.company_id = c.id), 0)
      + coalesce((SELECT sum(i.size_bytes) FROM public.pitch_images i WHERE i.company_id = c.id), 0),
    (SELECT max(a.created_at) FROM public.audit_logs a WHERE a.company_id = c.id)
  FROM public.companies c
$$;

REVOKE ALL ON FUNCTION public.platform_company_usage() FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.platform_company_usage() TO pitch_platform;

CREATE FUNCTION public.platform_totals()
RETURNS TABLE (companies integer, companies_active integer, users_active integer, pitches integer, storage_bytes bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT (SELECT count(*)::int FROM public.companies WHERE archived_at IS NULL),
         (SELECT count(*)::int FROM public.companies WHERE status IN ('ACTIVE', 'TRIAL')),
         (SELECT count(*)::int FROM public.users WHERE scope = 'COMPANY' AND status = 'ACTIVE' AND archived_at IS NULL),
         (SELECT count(*)::int FROM public.pitches WHERE archived_at IS NULL),
         coalesce((SELECT sum(size_bytes) FROM public.document_versions), 0) + coalesce((SELECT sum(size_bytes) FROM public.pitch_images), 0)
$$;

REVOKE ALL ON FUNCTION public.platform_totals() FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.platform_totals() TO pitch_platform;


-- ── 15. Grants ───────────────────────────────────────────────────────────────
-- pitch_app: identity data only through its own company's users (policies below); no login_attempts.
REVOKE ALL ON public.login_attempts FROM pitch_app;

REVOKE INSERT ON public.sessions FROM pitch_app;

REVOKE INSERT, UPDATE, DELETE ON public.permissions FROM pitch_app;

-- Company work never reads password hashes or MFA secrets and never writes identity/credential columns.
REVOKE ALL ON public.users FROM pitch_app;

GRANT SELECT (id, email, full_name, status, mfa_enabled, failed_login_count, locked_until, password_changed_at, last_login_at, clearance,
  created_at, updated_at, archived_at, company_id, scope, first_name, last_name, mobile_e164, profile_image_key, department, designation,
  employee_code, joining_date, disabled_at) ON public.users TO pitch_app;

-- Table-level INSERT (ORMs list every column, using DEFAULT for omitted ones); the guard trigger below
-- rejects any credential, MFA, sign-in or scope value supplied by company work.
GRANT INSERT ON public.users TO pitch_app;

CREATE FUNCTION public.users_company_insert_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF current_user = 'pitch_app' AND (
       NEW.password_hash IS NOT NULL OR NEW.mfa_secret_enc IS NOT NULL OR NEW.mfa_pending_secret_enc IS NOT NULL OR NEW.mfa_enabled
    OR NEW.mfa_last_step IS NOT NULL OR NEW.failed_login_count <> 0 OR NEW.locked_until IS NOT NULL OR NEW.last_login_at IS NOT NULL
    OR NEW.password_changed_at IS NOT NULL OR NEW.scope <> 'COMPANY') THEN
    RAISE EXCEPTION 'IDENTITY_FIELDS: company work cannot set credentials, MFA, sign-in state or account scope'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.users_company_insert_guard() FROM PUBLIC;

CREATE TRIGGER users_company_insert_guard BEFORE INSERT ON public.users FOR EACH ROW EXECUTE FUNCTION public.users_company_insert_guard();

GRANT UPDATE (full_name, status, clearance, locked_until, failed_login_count, first_name, last_name, mobile_e164, profile_image_key,
  department, designation, employee_code, joining_date, disabled_at, archived_at) ON public.users TO pitch_app;

GRANT SELECT ON public.companies, public.plans, public.subscriptions, public.usage_records, public.support_access_grants,
  public.company_email_domains, public.platform_catalog TO pitch_app;

GRANT UPDATE (name, legal_name, pitch_code_prefix, logo_key, favicon_key, brand_primary_color, website, industry, country, state, city, address,
  contact_person, contact_phone, primary_email, setup_completed_at) ON public.companies TO pitch_app;

GRANT SELECT, INSERT, DELETE ON public.company_allowed_emails TO pitch_app;

GRANT SELECT, INSERT, UPDATE ON public.user_invitations TO pitch_app;

GRANT SELECT, INSERT, DELETE ON public.system_settings TO pitch_app;

-- pitch_platform: platform tables + identity + read of role grants. No customer content tables.
GRANT SELECT, INSERT, UPDATE ON public.companies, public.plans, public.subscriptions, public.usage_records,
  public.support_access_grants, public.platform_catalog, public.user_invitations TO pitch_platform;

GRANT SELECT, INSERT ON public.subscription_events TO pitch_platform;

GRANT SELECT, INSERT, DELETE ON public.company_email_domains, public.company_allowed_emails TO pitch_platform;

GRANT SELECT, INSERT, UPDATE ON public.permissions TO pitch_platform;

GRANT SELECT, INSERT, UPDATE ON public.users TO pitch_platform;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.sessions, public.login_attempts, public.password_reset_tokens TO pitch_platform;

GRANT SELECT ON public.roles, public.user_roles, public.role_permissions, public.system_settings TO pitch_platform;

GRANT SELECT, INSERT ON public.audit_logs TO pitch_platform;

GRANT INSERT ON public.job_outbox TO pitch_platform;


-- ── 16. Row-level security ───────────────────────────────────────────────────
DO $$
DECLARE t text;
BEGIN
  -- remove the single-tenant "app server sees everything" policy everywhere
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS app_server_only ON public.%I', t);
  END LOOP;
  -- company-owned tables: company work sees and writes only the session company
  FOR t IN SELECT c.table_name FROM information_schema.columns c JOIN pg_tables p ON p.tablename = c.table_name AND p.schemaname = 'public'
            WHERE c.table_schema = 'public' AND c.column_name = 'company_id'
              AND c.table_name NOT IN ('users', 'audit_logs', 'companies', 'subscriptions', 'subscription_events', 'usage_records',
                                       'support_access_grants', 'company_email_domains', 'company_allowed_emails', 'user_invitations') LOOP
    EXECUTE format('CREATE POLICY tenant_isolation ON public.%I AS PERMISSIVE FOR ALL TO pitch_app
                    USING (company_id = (SELECT public.app_company_id())) WITH CHECK (company_id = (SELECT public.app_company_id()))', t);
  END LOOP;
END $$;

CREATE POLICY tenant_isolation ON public.users FOR ALL TO pitch_app
  USING (company_id = (SELECT public.app_company_id())) WITH CHECK (company_id = (SELECT public.app_company_id()));

CREATE POLICY platform_identity ON public.users FOR ALL TO pitch_platform USING (true) WITH CHECK (true);

CREATE POLICY tenant_users_sessions ON public.sessions FOR ALL TO pitch_app
  USING (EXISTS (SELECT 1 FROM public.users u WHERE u.id = sessions.user_id));

CREATE POLICY platform_identity ON public.sessions FOR ALL TO pitch_platform USING (true) WITH CHECK (true);

CREATE POLICY platform_identity ON public.login_attempts FOR ALL TO pitch_platform USING (true) WITH CHECK (true);

CREATE POLICY tenant_users_tokens ON public.password_reset_tokens FOR ALL TO pitch_app
  USING (EXISTS (SELECT 1 FROM public.users u WHERE u.id = password_reset_tokens.user_id))
  WITH CHECK (EXISTS (SELECT 1 FROM public.users u WHERE u.id = password_reset_tokens.user_id));

CREATE POLICY platform_identity ON public.password_reset_tokens FOR ALL TO pitch_platform USING (true) WITH CHECK (true);

CREATE POLICY tenant_isolation ON public.user_invitations FOR ALL TO pitch_app
  USING (company_id = (SELECT public.app_company_id())) WITH CHECK (company_id = (SELECT public.app_company_id()));

CREATE POLICY platform_identity ON public.user_invitations FOR ALL TO pitch_platform USING (true) WITH CHECK (true);

-- audit: companies see their own trail; the platform sees platform events and sign-in/security events only
CREATE POLICY tenant_isolation ON public.audit_logs FOR ALL TO pitch_app
  USING (company_id = (SELECT public.app_company_id())) WITH CHECK (company_id = (SELECT public.app_company_id()));

CREATE POLICY platform_audit_read ON public.audit_logs FOR SELECT TO pitch_platform
  USING (company_id IS NULL OR action LIKE 'auth.%' OR action LIKE 'security.%' OR action LIKE 'company.%' OR action LIKE 'support.%');

CREATE POLICY platform_audit_write ON public.audit_logs FOR INSERT TO pitch_platform WITH CHECK (true);

-- identity lookups during sign-in need a company's roles and security settings, never its content
CREATE POLICY platform_identity_read ON public.roles FOR SELECT TO pitch_platform USING (true);

CREATE POLICY platform_identity_read ON public.user_roles FOR SELECT TO pitch_platform USING (true);

CREATE POLICY platform_identity_read ON public.role_permissions FOR SELECT TO pitch_platform USING (true);

CREATE POLICY platform_identity_read ON public.system_settings FOR SELECT TO pitch_platform USING (true);

CREATE POLICY platform_outbox_write ON public.job_outbox FOR INSERT TO pitch_platform WITH CHECK (company_id IS NOT NULL);

-- own company row, subscription, usage, support grants, email policy: readable by the company
CREATE POLICY company_self ON public.companies FOR SELECT TO pitch_app USING (id = (SELECT public.app_company_id()));

CREATE POLICY company_self_update ON public.companies FOR UPDATE TO pitch_app
  USING (id = (SELECT public.app_company_id())) WITH CHECK (id = (SELECT public.app_company_id()));

CREATE POLICY platform_all ON public.companies FOR ALL TO pitch_platform USING (true) WITH CHECK (true);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['subscriptions', 'usage_records', 'support_access_grants', 'company_email_domains', 'company_allowed_emails'] LOOP
    EXECUTE format('CREATE POLICY company_self ON public.%I FOR ALL TO pitch_app
                    USING (company_id = (SELECT public.app_company_id())) WITH CHECK (company_id = (SELECT public.app_company_id()))', t);
    EXECUTE format('CREATE POLICY platform_all ON public.%I FOR ALL TO pitch_platform USING (true) WITH CHECK (true)', t);
  END LOOP;
END $$;

CREATE POLICY platform_all ON public.subscription_events FOR ALL TO pitch_platform USING (true) WITH CHECK (true);

CREATE POLICY readable ON public.plans FOR SELECT TO pitch_app USING (true);

CREATE POLICY platform_all ON public.plans FOR ALL TO pitch_platform USING (true) WITH CHECK (true);

CREATE POLICY readable ON public.platform_catalog FOR SELECT TO pitch_app USING (true);

CREATE POLICY platform_all ON public.platform_catalog FOR ALL TO pitch_platform USING (true) WITH CHECK (true);

CREATE POLICY readable ON public.permissions FOR SELECT TO pitch_app USING (true);

CREATE POLICY platform_all ON public.permissions FOR ALL TO pitch_platform USING (true) WITH CHECK (true);


-- ── 17. Data API roles (Supabase) never see anything ─────────────────────────
DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA public FROM %I', r);
      EXECUTE format('REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM %I', r);
      EXECUTE format('REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM %I', r);
    END IF;
  END LOOP;
END $$;


-- ── 18. Self-check: no company-owned row without a company ───────────────────
DO $$
DECLARE t text; n bigint;
BEGIN
  FOR t IN SELECT c.table_name FROM information_schema.columns c JOIN pg_tables p ON p.tablename = c.table_name AND p.schemaname = 'public'
            WHERE c.table_schema = 'public' AND c.column_name = 'company_id' AND c.table_name NOT IN ('audit_logs', 'users') LOOP
    EXECUTE format('SELECT count(*) FROM public.%I WHERE company_id IS NULL', t) INTO n;
    IF n > 0 THEN RAISE EXCEPTION 'table % has % rows without company_id', t, n; END IF;
  END LOOP;
  SELECT count(*) INTO n FROM public.users WHERE scope = 'COMPANY' AND company_id IS NULL;
  IF n > 0 THEN RAISE EXCEPTION '% company users without company_id', n; END IF;
END $$;


INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ('daa69355a68268d8a604856e854b09b63378e3a5fd9e402bdcb3ccb29723248c', 1789500000000);

COMMIT;
