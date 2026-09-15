-- Pitch Tracker: verify the setup. Every row must say PASS.
with actual(k,n,h) as (
select 'columns' k, count(*) n, md5(string_agg(table_name||'.'||column_name||':'||udt_name||':'||is_nullable||':'||coalesce(regexp_replace(column_default,'::[a-z_ ]+','','g'),''), '|' order by (table_name)::text collate "C", (column_name)::text collate "C")) h from information_schema.columns where table_schema='public'
union all select 'constraints', count(*), md5(string_agg(conrelid::regclass::text||'.'||conname||':'||regexp_replace(pg_get_constraintdef(oid),'"?public"?\.','','g'), '|' order by (conrelid::regclass::text)::text collate "C", (conname)::text collate "C")) from pg_constraint where connamespace='public'::regnamespace
union all select 'indexes', count(*), md5(string_agg(indexname||':'||regexp_replace(regexp_replace(indexdef,'public\.','','g'),'extensions\.',''), '|' order by (indexname)::text collate "C")) from pg_indexes where schemaname='public'
union all select 'triggers', count(*), md5(string_agg(event_object_table||'.'||trigger_name||':'||event_manipulation||':'||action_timing, '|' order by (event_object_table)::text collate "C", (trigger_name)::text collate "C", (event_manipulation)::text collate "C")) from information_schema.triggers where trigger_schema='public'
union all select 'enums', count(*), md5(string_agg(t.typname||':'||e.enumlabel, '|' order by (t.typname)::text collate "C", e.enumsortorder)) from pg_type t join pg_enum e on e.enumtypid=t.oid where t.typnamespace='public'::regnamespace
union all select 'app_grants', count(*), md5(string_agg(table_name||':'||privilege_type, '|' order by (table_name)::text collate "C", (privilege_type)::text collate "C")) from information_schema.role_table_grants where grantee='pitch_app' and table_schema='public'
union all select 'rls_off', count(*), '' from pg_tables where schemaname='public' and not rowsecurity
union all select 'policies', count(*), md5(string_agg(tablename||':'||policyname||':'||array_to_string(roles,','), '|' order by (tablename)::text collate "C")) from pg_policies where schemaname='public'
union all select 'fn_nopath', count(*), '' from pg_proc p where pronamespace='public'::regnamespace and proconfig is null and not exists (select 1 from pg_depend d where d.objid=p.oid and d.deptype='e')
union all select 'api_role_grants', count(*), '' from information_schema.role_table_grants where grantee in ('anon','authenticated','service_role') and table_schema='public'
union all
select 'permissions' t, count(*) n, md5(string_agg(key||description,'|' order by (key)::text collate "C")) h from permissions
union all select 'roles', count(*), md5(string_agg(key||name||is_system,'|' order by (key)::text collate "C")) from roles
union all select 'role_permissions', count(*), md5(string_agg(r.key||rp.permission_key,'|' order by (r.key)::text collate "C", (rp.permission_key)::text collate "C")) from role_permissions rp join roles r on r.id=rp.role_id
union all select 'lookup_values', count(*), md5(string_agg(type||key||label||coalesce(parent_key,'')||sort_order||active,'|' order by (type)::text collate "C", (key)::text collate "C")) from lookup_values
union all select 'rating_categories', count(*), md5(string_agg(key||label||sort_order||active,'|' order by (key)::text collate "C")) from rating_categories
union all select 'platforms', count(*), md5(string_agg(name||kind||language_keys::text||genre_keys::text||active,'|' order by (name)::text collate "C")) from platforms
union all select 'system_settings', count(*), md5(string_agg(key||value::text,'|' order by (key)::text collate "C")) from system_settings
union all select 'workflow_definitions', count(*), md5(string_agg(id||name||version||is_active||initial_stage_key,'|')) from workflow_definitions
union all select 'workflow_stages', count(*), md5(string_agg(definition_id||key||name||category||badge||is_terminal||requires_owner||sort_order,'|' order by sort_order)) from workflow_stages
union all select 'workflow_transitions', count(*), md5(string_agg(concat_ws(',',definition_id,from_stage_key,to_stage_key,action,required_permission,allowed_role_keys,requires_current_owner,requires_remarks,requires_rejection_reason,requires_recipient,recipient_role_keys,requires_change_types,requires_platform,is_approval),'|' order by (from_stage_key)::text collate "C", (action)::text collate "C", (to_stage_key)::text collate "C", (recipient_role_keys::text)::text collate "C")) from workflow_transitions
union all select 'functions', count(*), md5(string_agg(proname||prosrc||coalesce(array_to_string(proconfig,','),''),'|' order by (proname)::text collate "C")) from pg_proc p where pronamespace='public'::regnamespace and not exists (select 1 from pg_depend d where d.objid=p.oid and d.deptype='e')
), expected(k,n,h) as (values
('api_role_grants',0,''),
('app_grants',115,'4fceabe07647bca2896baa5c76ffa70f'),
('columns',403,'9e2afda8be14efc6a5a03f8d90665598'),
('constraints',133,'d0563aab417caf55823a5fec9a485757'),
('enums',100,'234862212b75d53fd8d20adf4509613c'),
('fn_nopath',0,''),
('functions',4,'26d83eec39cd54fb0663e6fab6df0788'),
('indexes',98,'45f74a4c9c8f458edce4e81ee3b546bb'),
('lookup_values',74,'091cfb8bdd9a73cb9d231cdf39702ba6'),
('permissions',38,'899cbbf78f64219d59d4cb82196715c4'),
('platforms',10,'e0af6265e3b29d0b2dd0f927f2dcd2a4'),
('policies',41,'85aff896716600592a2f7139598a5ee5'),
('rating_categories',6,'a08bf899b8c139c1b9fd21fbd18c6a19'),
('rls_off',0,''),
('role_permissions',162,'2c2f7e1abab692e47f3c5236a67eb40b'),
('roles',7,'d3d0fb1253117a87c19e50c1c5f7a8ec'),
('system_settings',4,'1e0e8b6243826c513fa0738b35399a6a'),
('triggers',42,'0223e31eb632a9bd5eafea310f74849f'),
('workflow_definitions',1,'67948784eaede82fe7e2871ee16d3dff'),
('workflow_stages',19,'7224955e97e898c30c54fcbe26ad0f9e'),
('workflow_transitions',60,'771ba17214765227b34ee08f053c9c6d')
)
select e.k as check_name, e.n as expected_count, a.n as actual_count,
       case when a.n = e.n and coalesce(a.h,'') = e.h then 'PASS' else 'FAIL' end as result
from expected e left join actual a on a.k = e.k
union all select 'storage_bucket_private', 1, (select count(*)::int from storage.buckets where id='pitch-files' and public=false), case when exists(select 1 from storage.buckets where id='pitch-files' and public=false) then 'PASS' else 'FAIL' end
order by 4, 1;
