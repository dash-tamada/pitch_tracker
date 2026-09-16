/**
 * One-time setup for running Pitch Tracker on your computer against the Supabase project.
 * Usage:  npm run setup:local
 *
 * What it does (every secret stays on this computer; nothing is printed or logged):
 *  1. Asks for the Supabase connection details and the certificate file.
 *  2. Connects as `postgres` over TLS with the certificate verified.
 *  3. Sets the `pitch_app` (company work) and `pitch_platform` (sign-in & platform admin) passwords as SCRAM-SHA-256
 *     verifiers computed here, so the plain passwords never reach the server.
 *  4. Signs in as both roles through the transaction pooler to prove the connections work.
 *  5. Writes .env.local (git-ignored) with fresh random keys.
 *  6. Optionally creates or resets the platform Super Admin (password typed at a hidden prompt).
 *
 * Non-interactive testing: every prompt can be pre-filled with an environment variable named SETUP_<KEY>.
 */
import { createHash, createHmac, pbkdf2Sync, randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import pg from "pg";
import { connectionConfig, decodeCaCert } from "../src/server/db/ssl";
import { ask } from "./lib/prompt";

const ENV_FILE = resolve(process.cwd(), ".env.local");

/** PostgreSQL SCRAM-SHA-256 verifier (RFC 5802 / RFC 7677), the same format Postgres stores in pg_authid. */
export function scramVerifier(password: string, salt = randomBytes(16), iterations = 4096): string {
  const salted = pbkdf2Sync(password.normalize("NFKC"), salt, iterations, 32, "sha256");
  const clientKey = createHmac("sha256", salted).update("Client Key").digest();
  const storedKey = createHash("sha256").update(clientKey).digest();
  const serverKey = createHmac("sha256", salted).update("Server Key").digest();
  return `SCRAM-SHA-256$${iterations}:${salt.toString("base64")}$${storedKey.toString("base64")}:${serverKey.toString("base64")}`;
}

function strongEnough(pw: string): string | null {
  if (pw.length < 20) return "must be at least 20 characters";
  if (/['"\\\s]/.test(pw)) return "must not contain quotes, backslashes or spaces (they break connection strings)";
  return null;
}

function redact(message: string, ...secrets: string[]): string {
  return secrets.filter(Boolean).reduce((m, s) => m.split(s).join("***"), message);
}

async function tryConnect(url: string, ca: string | undefined, label: string, secrets: string[]): Promise<pg.Client> {
  const client = new pg.Client({ ...connectionConfig(url, { DATABASE_CA_CERT: ca, APP_ENV: "production" }), connectionTimeoutMillis: 15_000 });
  try {
    await client.connect();
    return client;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`${label}: ${redact(msg, ...secrets)}`);
  }
}

async function main() {
  console.log("\nPitch Tracker — local setup against Supabase\nPasswords are hidden as you type and are never printed.\n");
  if (existsSync(ENV_FILE)) {
    const again = (await ask("OVERWRITE", ".env.local already exists. Replace it? (yes/no): ")).toLowerCase();
    if (again !== "yes") { console.log("Nothing changed."); return; }
  }

  console.log("In Supabase: open the project → Connect (top bar) → Session pooler. Copy the URI (it contains [YOUR-PASSWORD]).");
  const sessionUri = await ask("SESSION_URI", "Session pooler URI: ");
  let parsed: URL;
  try { parsed = new URL(sessionUri.replace("[YOUR-PASSWORD]", "placeholder")); } catch { throw new Error("That is not a valid connection URI."); }
  const userMatch = /^postgres\.([a-z0-9]{20})$/.exec(decodeURIComponent(parsed.username));
  if (!userMatch || !parsed.hostname.endsWith(".pooler.supabase.com")) throw new Error("Expected a Session pooler URI whose user is postgres.<project-ref> on *.pooler.supabase.com.");
  const ref = userMatch[1]!;
  const host = parsed.hostname;

  // Windows "Copy as path" wraps the path in quotes; accept that.
  const caPath = (await ask("CA_PATH", "Path to the downloaded certificate (e.g. D:\\secure\\supabase-ca.crt): ")).replace(/^["']+|["']+$/g, "").trim();
  if (!existsSync(caPath)) throw new Error(`Certificate file not found: ${caPath}`);
  const ca = decodeCaCert(readFileSync(caPath, "utf8"))!;

  const pgPassword = await ask("POSTGRES_PASSWORD", "Database (postgres) password: ", { hidden: true });
  let appPassword = await ask("APP_PASSWORD", "Choose a NEW password for pitch_app (20+ chars, no quotes/spaces): ", { hidden: true });
  for (let problem = strongEnough(appPassword); problem; problem = strongEnough(appPassword)) {
    console.log(`  That password ${problem}.`);
    appPassword = await ask("APP_PASSWORD_RETRY", "pitch_app password: ", { hidden: true });
  }
  let platformPassword = await ask("PLATFORM_PASSWORD", "Choose a NEW password for pitch_platform (20+ chars, no quotes/spaces, different from pitch_app): ", { hidden: true });
  for (let problem = strongEnough(platformPassword) ?? (platformPassword === appPassword ? "must differ from the pitch_app password" : null); problem;
    problem = strongEnough(platformPassword) ?? (platformPassword === appPassword ? "must differ from the pitch_app password" : null)) {
    console.log(`  That password ${problem}.`);
    platformPassword = await ask("PLATFORM_PASSWORD_RETRY", "pitch_platform password: ", { hidden: true });
  }
  const secretKey = await ask("SECRET_KEY", "Supabase secret key for Storage (Project Settings → API Keys → Secret keys): ", { hidden: true });
  if (!/^sb_secret_[A-Za-z0-9_-]{10,}$/.test(secretKey) && !/^eyJ[\w-]+\.[\w-]+\.[\w-]+$/.test(secretKey)) {
    throw new Error("That does not look like a Supabase secret key (sb_secret_…) or a service_role key.");
  }
  const secrets = [pgPassword, appPassword, platformPassword, secretKey];

  console.log("\n1/4 Connecting as postgres (certificate verified)…");
  const admin = await tryConnect(`postgresql://postgres.${ref}:${encodeURIComponent(pgPassword)}@${host}:5432/postgres`, ca, "Could not connect as postgres", secrets);
  try {
    const { rows } = await admin.query<{ app: boolean; platform: boolean }>(
      "select exists(select 1 from pg_roles where rolname = 'pitch_app') as app, exists(select 1 from pg_roles where rolname = 'pitch_platform') as platform");
    if (!rows[0]?.app) throw new Error("Role pitch_app does not exist. Run the initial database setup first.");
    if (!rows[0]?.platform) throw new Error("Role pitch_platform does not exist. Run deploy/3-multi-tenant-upgrade.sql first.");
    console.log("2/4 Setting the pitch_app and pitch_platform passwords (hashed on this computer)…");
    for (const [role, pw] of [["pitch_app", appPassword], ["pitch_platform", platformPassword]] as const) {
      const verifier = scramVerifier(pw);
      if (!/^SCRAM-SHA-256\$\d+:[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$/.test(verifier)) throw new Error("internal: bad verifier");
      await admin.query(`ALTER ROLE ${role} WITH LOGIN PASSWORD '${verifier}'`);
    }
  } finally {
    await admin.end();
  }

  console.log("3/4 Signing in as pitch_app and pitch_platform through the transaction pooler…");
  const databaseUrl = `postgresql://pitch_app.${ref}:${encodeURIComponent(appPassword)}@${host}:6543/postgres`;
  let app: pg.Client;
  try {
    app = await tryConnect(databaseUrl, ca, "transaction pooler", secrets);
  } catch (e) {
    // Supavisor may need a moment to pick up a new password.
    console.log("  First attempt failed; retrying in 10 seconds…");
    await new Promise((r) => setTimeout(r, 10_000));
    void e;
    app = await tryConnect(databaseUrl, ca, "Could not sign in as pitch_app via the transaction pooler", secrets);
  }
  try {
    // Without a company context the company role must see nothing (row-level security fails closed).
    const { rows } = await app.query<{ usr: string; visible: number }>("select current_user as usr, (select count(*)::int from roles) as visible");
    if (rows[0]?.usr !== "pitch_app" || rows[0].visible !== 0) throw new Error(`Unexpected database state for pitch_app: ${JSON.stringify(rows[0])}`);
    console.log("  pitch_app connected; sees no company data without a company context (expected).");
  } finally {
    await app.end();
  }
  const platformUrl = `postgresql://pitch_platform.${ref}:${encodeURIComponent(platformPassword)}@${host}:6543/postgres`;
  let plat: pg.Client;
  try { plat = await tryConnect(platformUrl, ca, "transaction pooler", secrets); } catch {
    console.log("  First attempt failed; retrying in 10 seconds…");
    await new Promise((r) => setTimeout(r, 10_000));
    plat = await tryConnect(platformUrl, ca, "Could not sign in as pitch_platform via the transaction pooler", secrets);
  }
  try {
    const { rows } = await plat.query<{ usr: string; companies: number }>("select current_user as usr, (select count(*)::int from companies) as companies");
    if (rows[0]?.usr !== "pitch_platform" || rows[0].companies < 1) throw new Error(`Unexpected database state for pitch_platform: ${JSON.stringify(rows[0])}`);
    console.log(`  pitch_platform connected; ${rows[0].companies} company(ies) found.`);
  } finally {
    await plat.end();
  }

  console.log("4/4 Writing .env.local…");
  const b64 = (n: number) => randomBytes(n).toString("base64");
  const lines = [
    "# Generated by npm run setup:local — git-ignored. NEVER commit or share.",
    "NODE_ENV=development",
    "APP_ENV=development",
    "APP_ORIGIN=http://localhost:3000",
    "TRUST_PROXY=false",
    `DATABASE_URL=${databaseUrl}`,
    `PLATFORM_DATABASE_URL=${platformUrl}`,
    `DATABASE_CA_CERT=${Buffer.from(ca).toString("base64")}`,
    "# MFA_ENCRYPTION_KEY must be IDENTICAL in Vercel, otherwise MFA set up locally cannot be read in production.",
    `MFA_ENCRYPTION_KEY=${b64(32)}`,
    `SESSION_TOKEN_PEPPER=${b64(32)}`,
    `CRON_SECRET=${randomBytes(32).toString("hex")}`,
    `SUPABASE_URL=https://${ref}.supabase.co`,
    `SUPABASE_SECRET_KEY=${secretKey}`,
    "STORAGE_BUCKET=pitch-files",
    "",
  ];
  writeFileSync(ENV_FILE, lines.join("\n"), { encoding: "utf8", mode: 0o600 });
  const ignored = spawnSync("git", ["check-ignore", "-q", ".env.local"]).status === 0;
  console.log(`  Saved. Git ignores it: ${ignored ? "yes" : "NO — do not commit!"}`);

  const create = (await ask("CREATE_ADMIN", "\nCreate or reset the platform Super Admin now? (yes/no): ")).toLowerCase();
  if (create === "yes") {
    // The script asks for the email, name and password itself (hidden); nothing is passed on the command line.
    const r = spawnSync(process.execPath, ["--import", "tsx", "scripts/create-platform-super-admin.ts"], {
      stdio: "inherit",
      env: { ...process.env, PLATFORM_DATABASE_URL: platformUrl, DATABASE_CA_CERT: ca, APP_ENV: "development" },
    });
    if (r.status !== 0) console.log("Super Admin was not created (see message above). You can run it again later with: npm run admin:create");
  }

  console.log("\nDone. Start the app with:  npm run dev   then open http://localhost:3000");
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename ?? "")) {
  main().catch((e: unknown) => {
    console.error(`\nSetup stopped: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  });
}
