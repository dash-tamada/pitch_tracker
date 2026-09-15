import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

export type Db = NodePgDatabase<typeof schema>;
/** A database handle or an open transaction — services accept either. */
export type DbOrTx = Db | Parameters<Parameters<Db["transaction"]>[0]>[0];

export function createDb(connectionString: string, max = 10): { db: Db; pool: pg.Pool } {
  const pool = new pg.Pool({
    connectionString,
    max,
    idleTimeoutMillis: 30_000,
    statement_timeout: 15_000,
    application_name: "pitch-tracker",
  });
  return { db: drizzle(pool, { schema }), pool };
}

let singleton: Db | undefined;

/** Runtime handle using the least-privilege `pitch_app` role. */
export function getDb(): Db {
  if (!singleton) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set");
    singleton = createDb(url).db;
  }
  return singleton;
}
