/** Seeds configuration only (roles, permissions, workflow, lookups, platforms). Safe in every environment. */
import { createDb } from "../src/server/db/client";
import { seedConfig } from "../src/server/config/seed-config";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set");
const { db, pool } = createDb(url, 1);
seedConfig(db).then(() => { console.log("Configuration seeded."); return pool.end(); })
  .catch((e: unknown) => { console.error("Seed failed:", e instanceof Error ? (e.cause as { message?: string } | undefined)?.message ?? e.name : "unknown"); process.exit(1); });
