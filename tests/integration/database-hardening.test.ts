import { afterAll, describe, expect, it } from "vitest";
import pg from "pg";

const pool = new pg.Pool({ connectionString: process.env.TEST_MIGRATION_DATABASE_URL, max: 1 });
afterAll(() => pool.end());

describe("database hardening (Supabase Data API exposure)", () => {
  it("every table in public has Row Level Security enabled with only the app-server policy", async () => {
    const { rows } = await pool.query(`
      SELECT c.relname, c.relrowsecurity,
             (SELECT array_agg(p.polname || ':' || array_to_string(ARRAY(SELECT rolname FROM pg_roles WHERE oid = ANY(p.polroles)), ','))
                FROM pg_policy p WHERE p.polrelid = c.oid) AS policies
        FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relkind = 'r'`);
    expect(rows.length).toBe(41);
    for (const r of rows) {
      expect(r.relrowsecurity, r.relname).toBe(true);
      expect(r.policies, r.relname).toEqual(["app_server_only:pitch_app"]);
    }
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
