import { afterAll, describe, expect, it } from "vitest";
import pg from "pg";

const pool = new pg.Pool({ connectionString: process.env.TEST_MIGRATION_DATABASE_URL, max: 1 });
afterAll(() => pool.end());

describe("database hardening (Supabase Data API exposure)", () => {
  it("every table has Row Level Security; policies exist only for the two server roles; company work is never unrestricted", async () => {
    const { rows } = await pool.query(`
      SELECT c.relname, c.relrowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relkind = 'r'`);
    expect(rows.length).toBe(51);
    for (const r of rows) expect(r.relrowsecurity, r.relname).toBe(true);
    const policies = await pool.query(`SELECT tablename, policyname, roles::text[] AS roles, qual, with_check FROM pg_policies WHERE schemaname = 'public'`);
    for (const p of policies.rows) {
      expect(p.roles.every((r: string) => r === "pitch_app" || r === "pitch_platform"), `${p.tablename}.${p.policyname}`).toBe(true);
      // Unrestricted company-role access is allowed only on shared, non-customer reference tables.
      if (p.roles.includes("pitch_app") && p.qual === "true") expect(["plans", "platform_catalog", "permissions"], p.tablename).toContain(p.tablename);
    }
    expect(policies.rows.some((p) => p.policyname === "app_server_only")).toBe(false);
  });

  it("every company-owned table is isolated by app.company_id for the app role, and the platform role cannot read content", async () => {
    const { rows } = await pool.query(`
      SELECT c.table_name,
             EXISTS (SELECT 1 FROM pg_policies p WHERE p.schemaname = 'public' AND p.tablename = c.table_name AND 'pitch_app' = ANY (p.roles)
                      AND p.qual LIKE '%app_company_id()%') AS isolated
        FROM information_schema.columns c JOIN pg_tables t ON t.tablename = c.table_name AND t.schemaname = 'public'
       WHERE c.table_schema = 'public' AND c.column_name = 'company_id' AND c.table_name NOT IN ('subscription_events')`);
    expect(rows.length).toBeGreaterThanOrEqual(42);
    for (const r of rows) expect(r.isolated, r.table_name).toBe(true);
    const content = ["pitches", "creators", "documents", "document_versions", "pitch_images", "ratings", "platform_responses", "workflow_events", "notifications"];
    for (const t of content) {
      const { rows: priv } = await pool.query(`SELECT has_table_privilege('pitch_platform', $1, 'SELECT') AS s`, [`public.${t}`]);
      expect(priv[0].s, t).toBe(false);
    }
    const { rows: cols } = await pool.query(`SELECT has_column_privilege('pitch_app', 'public.users', 'password_hash', 'SELECT') AS pw,
      has_column_privilege('pitch_app', 'public.users', 'mfa_secret_enc', 'SELECT') AS mfa`);
    expect(cols[0]).toEqual({ pw: false, mfa: false });
  });

  it("anon, authenticated and service_role have no privilege on any table, sequence or function", async () => {
    const { rows } = await pool.query(`
      SELECT r.rolname, c.relname, c.relkind
        FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        CROSS JOIN (VALUES ('anon'), ('authenticated'), ('service_role')) AS r(rolname)
       WHERE n.nspname = 'public' AND c.relkind IN ('r', 'S')
         AND (has_table_privilege(r.rolname, c.oid, 'SELECT') OR has_table_privilege(r.rolname, c.oid, 'INSERT')
              OR has_table_privilege(r.rolname, c.oid, 'UPDATE') OR has_table_privilege(r.rolname, c.oid, 'DELETE'))`);
    expect(rows).toEqual([]);
    const fns = await pool.query(`
      SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public'
         AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e') -- extension-owned (pg_trgm)
         AND (has_function_privilege('anon', p.oid, 'EXECUTE') OR has_function_privilege('authenticated', p.oid, 'EXECUTE'))`);
    expect(fns.rows).toEqual([]);
  });

  it("a table created later by the migrator is not granted to API roles by default", async () => {
    await pool.query("CREATE TABLE IF NOT EXISTS public.zz_default_priv_probe (id int)");
    const { rows } = await pool.query("SELECT has_table_privilege('anon', 'public.zz_default_priv_probe', 'SELECT') AS anon_select");
    await pool.query("DROP TABLE public.zz_default_priv_probe");
    expect(rows[0].anon_select).toBe(false);
  });

  it("pg_trgm lives in the extensions schema and the app role can use it", async () => {
    const { rows } = await pool.query(`
      SELECT n.nspname, has_schema_privilege('pitch_app', n.oid, 'USAGE') AS usage
        FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace WHERE e.extname = 'pg_trgm'`);
    expect(rows).toEqual([{ nspname: "extensions", usage: true }]);
  });

  it("trigger functions have a pinned search_path", async () => {
    const { rows } = await pool.query(`
      SELECT proname, proconfig FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public' AND proname IN ('forbid_mutation','document_versions_guard','workflow_config_guard','touch_updated_at')`);
    expect(rows).toHaveLength(4);
    for (const r of rows) expect(r.proconfig, r.proname).toContain('search_path=""');
  });
});
