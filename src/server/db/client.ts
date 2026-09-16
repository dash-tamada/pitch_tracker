/**
 * Database handles.
 *
 * Two runtime roles, two handles:
 *  - Company work  → `pitch_app`. Every statement runs inside a transaction whose first statement sets the
 *    transaction-local `app.company_id`. Row-level security then limits reads AND writes to that company,
 *    and new rows default to it. Without a company the role sees nothing (fail closed).
 *  - Identity & platform administration → `pitch_platform` (sign-in, sessions, companies, plans, usage).
 *    It has no privileges on customer content tables at all.
 *
 * The company id is taken only from the server-side session (Actor.companyId), never from a request.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";
import { connectionConfig } from "./ssl";

export type Db = NodePgDatabase<typeof schema>;
/** A database handle or an open transaction — services accept either. */
export type DbOrTx = Db | Parameters<Parameters<Db["transaction"]>[0]>[0];

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function createPool(connectionString: string, max = 10): pg.Pool {
  return new pg.Pool({
    ...connectionConfig(connectionString),
    max,
    idleTimeoutMillis: 30_000,
    statement_timeout: 15_000,
    application_name: "pitch-tracker",
  });
}

/** Unscoped handle. Used by scripts/migrations and for the platform role. Never for company work with pitch_app. */
export function createDb(connectionString: string, max = 10): { db: Db; pool: pg.Pool } {
  const pool = createPool(connectionString, max);
  return { db: drizzle(pool, { schema }), pool };
}

type QueryArgs = Parameters<pg.PoolClient["query"]>;

/**
 * pg.Pool look-alike that pins every statement to one company.
 * The class name must contain "Pool": Drizzle uses it to decide that transactions need a dedicated connection.
 *  - single statements: BEGIN + set_config → statement → COMMIT on one connection (safe with Supavisor transaction mode)
 *  - Drizzle transactions: set_config runs immediately after Drizzle's own BEGIN on the same connection
 */
export class TenantPool {
  private readonly prelude: string;

  constructor(private readonly pool: pg.Pool, readonly companyId: string) {
    if (!UUID_RE.test(companyId)) throw new Error("TenantPool: invalid company id");
    // Inlined only after strict UUID validation above; set_config(..., true) is transaction-local.
    this.prelude = `SELECT set_config('app.company_id', '${companyId}', true)`;
  }

  async query(...args: QueryArgs): Promise<pg.QueryResult> {
    const client = await this.pool.connect();
    let broken: Error | undefined;
    try {
      await client.query(`BEGIN; ${this.prelude}`);
      try {
        const res = await (client.query as (...a: unknown[]) => Promise<pg.QueryResult>)(...args);
        await client.query("COMMIT");
        return res;
      } catch (e) {
        await client.query("ROLLBACK").catch((re: Error) => { broken = re; });
        throw e;
      }
    } finally {
      client.release(broken);
    }
  }

  async connect() {
    const client = await this.pool.connect();
    const prelude = this.prelude;
    let inTx = false;
    return {
      query: async (...args: QueryArgs) => {
        const text = typeof args[0] === "string" ? args[0] : (args[0] as { text?: string }).text ?? "";
        const res = await (client.query as (...a: unknown[]) => Promise<pg.QueryResult>)(...args);
        if (/^\s*begin\b/i.test(text)) { await client.query(prelude); inTx = true; }
        else if (/^\s*(commit|rollback)\s*$/i.test(text)) inTx = false;
        return res;
      },
      release: (err?: Error | boolean) => {
        // A connection returned mid-transaction must not be reused.
        client.release(inTx ? new Error("released inside transaction") : err);
      },
    };
  }

  end(): Promise<void> { return Promise.resolve(); }
}

export function createTenantDb(pool: pg.Pool, companyId: string): Db {
  return drizzle(new TenantPool(pool, companyId) as unknown as pg.Pool, { schema });
}

/* ───────────── Runtime singletons ───────────── */

let appPool: pg.Pool | undefined;
let platformDb: Db | undefined;
const tenantCache = new Map<string, Db>();
const companyContext = new AsyncLocalStorage<{ companyId: string }>();

function getAppPool(): pg.Pool {
  if (!appPool) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set");
    appPool = createPool(url);
  }
  return appPool;
}

export function tenantDb(companyId: string): Db {
  let db = tenantCache.get(companyId);
  if (!db) {
    db = createTenantDb(getAppPool(), companyId);
    if (tenantCache.size > 1000) tenantCache.clear();
    tenantCache.set(companyId, db);
  }
  return db;
}

/**
 * Company-scoped handle (`pitch_app`).
 *  - `getDb(actor)` in pages/services that hold the session actor
 *  - `getDb()` inside an API route handler (company set by route() from the session)
 * Throws when no company is known, so a missing context can never mean "all companies".
 */
export function getDb(actor?: { readonly companyId: string | null }): Db {
  const companyId = actor ? actor.companyId : companyContext.getStore()?.companyId;
  if (!companyId) throw new Error("No company context for this database access");
  return tenantDb(companyId);
}

/** Runs `fn` with a company context (used by route() and the per-company job runner). */
export function withCompany<T>(companyId: string, fn: () => Promise<T>): Promise<T> {
  if (!UUID_RE.test(companyId)) throw new Error("withCompany: invalid company id");
  return companyContext.run({ companyId }, fn);
}

/** Identity & platform handle (`pitch_platform`). No access to customer content. */
export function getPlatformDb(): Db {
  if (!platformDb) {
    const url = process.env.PLATFORM_DATABASE_URL;
    if (!url) throw new Error("PLATFORM_DATABASE_URL is not set");
    platformDb = createDb(url, 5).db;
  }
  return platformDb;
}
