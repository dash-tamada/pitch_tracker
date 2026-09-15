/**
 * Recreates the test database from scratch, applies migrations with the MIGRATION role,
 * then seeds configuration with the least-privilege APP role (proving the grants are sufficient).
 */
import { config } from "dotenv";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";

export default async function setup(): Promise<void> {
  config({ path: ".env.local", quiet: true });
  const migUrl = new URL(required("TEST_MIGRATION_DATABASE_URL"));
  const dbName = migUrl.pathname.slice(1);
  if (!/test/i.test(dbName)) throw new Error(`Refusing to reset non-test database "${dbName}"`);

  const admin = new pg.Client({ connectionString: Object.assign(new URL(migUrl), { pathname: "/postgres" }).toString() });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
  await admin.query(`CREATE DATABASE "${dbName}"`);
  await admin.end();

  const migPool = new pg.Pool({ connectionString: migUrl.toString(), max: 1 });
  await migrate(drizzle(migPool), { migrationsFolder: "./drizzle" });
  await migPool.end();

  process.env.DATABASE_URL = required("TEST_DATABASE_URL");
  const { createDb } = await import("../../src/server/db/client");
  const { seedConfig } = await import("../../src/server/config/seed-config");
  const { db, pool } = createDb(required("TEST_DATABASE_URL"), 2);
  await seedConfig(db);
  await pool.end();
}

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set (see .env.example)`);
  return v;
}
