/**
 * Applies SQL migrations using the MIGRATION role (never the runtime app role).
 * Usage: MIGRATION_DATABASE_URL=... npx tsx scripts/migrate.ts
 */
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import { connectionConfig } from "../src/server/db/ssl";

async function main(): Promise<void> {
  const url = process.env.MIGRATION_DATABASE_URL;
  if (!url) throw new Error("MIGRATION_DATABASE_URL is not set");
  const pool = new pg.Pool({ ...connectionConfig(url), max: 1 });
  try {
    await migrate(drizzle(pool), { migrationsFolder: "./drizzle" });
    console.log("Migrations applied.");
  } finally {
    await pool.end();
  }
}

main().catch((err: unknown) => {
  // Print the drizzle-level message plus the underlying Postgres error's own message (never the connection
  // string itself, and never the raw pg error object, which could carry query parameter values).
  const cause = err instanceof Error ? (err.cause as { message?: string } | undefined)?.message : undefined;
  console.error("Migration failed:", err instanceof Error ? err.message : "unknown error", cause ? `\nCause: ${cause}` : "");
  process.exit(1);
});
