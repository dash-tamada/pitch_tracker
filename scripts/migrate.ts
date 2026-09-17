/**
 * Applies SQL migrations using the MIGRATION role (never the runtime app role).
 * Usage: npm run db:migrate (reads MIGRATION_DATABASE_URL from .env.local, like seed.ts/seed-demo.ts do —
 * previously this was the one db script that didn't, which meant it silently used whatever was already in
 * the shell environment instead of .env.local).
 */
import { config } from "dotenv";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import { connectionConfig } from "../src/server/db/ssl";

config({ path: ".env.local", quiet: true });

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
