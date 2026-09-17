/**
 * Seeds the platform catalogue (permissions, plans, platform list). Safe in every environment; no people, no content.
 * Companies get their own defaults when the Super Admin creates them.
 * Usage: PLATFORM_DATABASE_URL=... npx tsx scripts/seed.ts
 */
import { config } from "dotenv";
import { createDb } from "../src/server/db/client";
import { seedPlatform } from "../src/server/modules/tenancy/provision";

config({ path: ".env.local", quiet: true });
const url = process.env.PLATFORM_DATABASE_URL;
if (!url) throw new Error("PLATFORM_DATABASE_URL is not set");
const { db, pool } = createDb(url, 1);
seedPlatform(db).then(() => { console.log("Platform catalogue seeded."); return pool.end(); })
  .catch((e: unknown) => {
    const cause = e instanceof Error ? (e.cause as { message?: string } | undefined)?.message : undefined;
    console.error("Seed failed:", e instanceof Error ? e.message : "unknown error", cause ? `\nCause: ${cause}` : "");
    process.exit(1);
  });
