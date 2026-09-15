/**
 * Applies SQL migrations using the MIGRATION role (never the runtime app role).
 * Usage: MIGRATION_DATABASE_URL=... npx tsx scripts/migrate.ts
 */
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";

async function main(): Promise<void> {
  const url = process.env.MIGRATION_DATABASE_URL;
  if (!url) throw new Error("MIGRATION_DATABASE_URL is not set");
  const pool = new pg.Pool({ connectionString: url, max: 1 });
  try {
    await migrate(drizzle(pool), { migrationsFolder: "./drizzle" });
    console.log("Migrations applied.");
  } finally {
    await pool.end();
  }
}

main().catch((err: unknown) => {
  // Print message only; connection strings must never be logged.
  console.error("Migration failed:", err instanceof Error ? err.message : "unknown error");
  process.exit(1);
});
