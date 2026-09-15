import { execFileSync } from "node:child_process";
import pg from "pg";

/** Fresh database for every E2E run: migrate with the migration role, seed config and demo data with the app role. */
export default async function globalSetup() {
  const mig = process.env.E2E_MIGRATION_DATABASE_URL ?? "postgres://pitch_migrator:dev_migrator_local_only@localhost:5432/pitch_e2e";
  const app = process.env.E2E_DATABASE_URL ?? "postgres://pitch_app:dev_app_local_only@localhost:5432/pitch_e2e";
  const u = new URL(mig);
  const name = u.pathname.slice(1);
  if (!/e2e|test/i.test(name)) throw new Error("Refusing to reset a non-test database");
  const admin = new pg.Client({ connectionString: Object.assign(new URL(mig), { pathname: "/postgres" }).toString() });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
  await admin.query(`CREATE DATABASE "${name}"`);
  await admin.end();
  const env = { ...process.env, MIGRATION_DATABASE_URL: mig, DATABASE_URL: app, SESSION_TOKEN_PEPPER: Buffer.alloc(32, 3).toString("base64") };
  execFileSync("npx", ["tsx", "scripts/migrate.ts"], { env, stdio: "inherit" });
  execFileSync("npx", ["tsx", "scripts/seed.ts"], { env, stdio: "inherit" });
  execFileSync("npx", ["tsx", "scripts/seed-demo.ts"], { env: { ...env, DEMO_USER_PASSWORD: "Demo-Monsoon-2026!" }, stdio: "inherit" });
}
