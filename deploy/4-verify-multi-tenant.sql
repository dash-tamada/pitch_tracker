-- Pitch Tracker — read-only checks after 3-multi-tenant-upgrade.sql. Every row must say PASS.
WITH checks(name, ok) AS (
  VALUES
  ('migration 0006 recorded', (SELECT count(*) = 7 FROM drizzle.__drizzle_migrations)),
  ('company TAM exists and is ACTIVE', EXISTS (SELECT 1 FROM public.companies WHERE code = 'TAM' AND status = 'ACTIVE')),
  ('TAM has an ACTIVE subscription', EXISTS (SELECT 1 FROM public.subscriptions s JOIN public.companies c ON c.id = s.company_id WHERE c.code = 'TAM' AND s.status = 'ACTIVE')),
  ('3 default plans', (SELECT count(*) = 3 FROM public.plans)),
  ('no company user without company', NOT EXISTS (SELECT 1 FROM public.users WHERE scope = 'COMPANY' AND company_id IS NULL)),
  ('no platform accounts created by the upgrade', NOT EXISTS (SELECT 1 FROM public.users WHERE scope = 'PLATFORM')),
  ('no pitch without company', NOT EXISTS (SELECT 1 FROM public.pitches WHERE company_id IS NULL)),
  ('no creator without company', NOT EXISTS (SELECT 1 FROM public.creators WHERE company_id IS NULL)),
  ('no document version without company', NOT EXISTS (SELECT 1 FROM public.document_versions WHERE company_id IS NULL)),
  ('SUPER_ADMIN role renamed', NOT EXISTS (SELECT 1 FROM public.roles WHERE key = 'SUPER_ADMIN')),
  ('no SUPER_ADMIN left in workflow rules', NOT EXISTS (SELECT 1 FROM public.workflow_transitions WHERE 'SUPER_ADMIN' = ANY (coalesce(allowed_role_keys, '{}') || coalesce(recipient_role_keys, '{}')))),
  ('70 composite tenant foreign keys', (SELECT count(*) = 70 FROM pg_constraint WHERE contype = 'f' AND conname LIKE '%tenant_fk')),
  ('RLS enabled on every public table', NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND NOT rowsecurity)),
  ('old app_server_only policy removed', NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'app_server_only')),
  ('every company table isolated for pitch_app', NOT EXISTS (
     SELECT 1 FROM information_schema.columns c JOIN pg_tables t ON t.tablename = c.table_name AND t.schemaname = 'public'
      WHERE c.table_schema = 'public' AND c.column_name = 'company_id' AND c.table_name <> 'subscription_events'
        AND NOT EXISTS (SELECT 1 FROM pg_policies p WHERE p.schemaname = 'public' AND p.tablename = c.table_name AND 'pitch_app' = ANY (p.roles) AND p.qual LIKE '%app_company_id()%'))),
  ('pitch_platform role exists', EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pitch_platform')),
  ('pitch_platform cannot read pitches', NOT has_table_privilege('pitch_platform', 'public.pitches', 'SELECT')),
  ('pitch_platform cannot read documents', NOT has_table_privilege('pitch_platform', 'public.document_versions', 'SELECT')),
  ('pitch_app cannot read password hashes', NOT has_column_privilege('pitch_app', 'public.users', 'password_hash', 'SELECT')),
  ('API roles have no table access', NOT EXISTS (
     SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace CROSS JOIN (VALUES ('anon'), ('authenticated'), ('service_role')) r(rolname)
      WHERE n.nspname = 'public' AND c.relkind = 'r' AND (has_table_privilege(r.rolname, c.oid, 'SELECT') OR has_table_privilege(r.rolname, c.oid, 'INSERT')))),
  ('pitch codes unchanged (no duplicates per company)', NOT EXISTS (SELECT company_id, pitch_code FROM public.pitches GROUP BY 1, 2 HAVING count(*) > 1))
)
SELECT CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END AS result, name FROM checks ORDER BY ok, name COLLATE "C";
