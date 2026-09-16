/**
 * Creates (or resets the password of) the PLATFORM Super Admin — the account that manages companies, plans and
 * support access. It belongs to no company and cannot open any company's pitches, scripts or documents.
 *
 * Usage:  npm run admin:create -- dash.tamad@gmail.com "Full Name"
 * The password is typed at a hidden prompt (never a command-line argument, never printed, never stored in plain text).
 * Uses PLATFORM_DATABASE_URL (role pitch_platform) from .env.local / the environment.
 */
import { config } from "dotenv";
import { eq } from "drizzle-orm";
import { createDb } from "../src/server/db/client";
import { sessions, users } from "../src/server/db/schema";
import { hashPassword, passwordPolicyErrors } from "../src/server/modules/auth/password";
import { writeAudit } from "../src/server/modules/audit/service";
import { ask } from "./lib/prompt";

config({ path: ".env.local", quiet: true });
const PLATFORM_MIN_LENGTH = 16;

async function main() {
  const [rawEmail, fullNameArg] = process.argv.slice(2);
  const email = (rawEmail ?? (await ask("ADMIN_EMAIL", "Super Admin email: "))).trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) throw new Error("That is not a valid email address.");
  const fullName = (fullNameArg ?? (await ask("ADMIN_NAME", "Full name: "))).trim();
  if (fullName.length < 2 || fullName.length > 120) throw new Error("Full name must be 2–120 characters.");

  let password = "";
  for (;;) {
    password = await ask("ADMIN_PASSWORD", `Password (hidden, at least ${PLATFORM_MIN_LENGTH} characters): `, { hidden: true });
    const errors = passwordPolicyErrors(password, { email, fullName });
    if (password.length < PLATFORM_MIN_LENGTH) errors.unshift(`Platform accounts need at least ${PLATFORM_MIN_LENGTH} characters.`);
    if (!errors.length) break;
    console.log(`  Not accepted: ${errors.join(" ")}`);
    if (process.env.SETUP_ADMIN_PASSWORD !== undefined) throw new Error("Password rejected.");
  }
  const confirm = await ask("ADMIN_PASSWORD_CONFIRM", "Repeat password: ", { hidden: true });
  if (confirm !== password) throw new Error("Passwords do not match.");

  const url = process.env.PLATFORM_DATABASE_URL;
  if (!url) throw new Error("PLATFORM_DATABASE_URL is not set (run npm run setup:local first).");
  const { db, pool } = createDb(url, 1);
  try {
    const outcome = await db.transaction(async (tx) => {
      const [existing] = await tx.select({ id: users.id, scope: users.scope }).from(users).where(eq(users.email, email)).for("update");
      const passwordHash = await hashPassword(password);
      if (existing) {
        // Never silently turn a company employee into a platform administrator.
        if (existing.scope !== "PLATFORM") throw new Error("This email belongs to a company account. Use a different email for the platform Super Admin.");
        await tx.update(users).set({ passwordHash, passwordChangedAt: new Date(), failedLoginCount: 0, lockedUntil: null, status: "ACTIVE" }).where(eq(users.id, existing.id));
        await tx.update(sessions).set({ revokedAt: new Date() }).where(eq(sessions.userId, existing.id));
        await writeAudit(tx, { companyId: null, actorId: null, action: "security.platform_admin_password_reset", resourceType: "user", resourceId: existing.id });
        return "Password reset; existing sessions were signed out.";
      }
      const [u] = await tx.insert(users).values({ email, fullName, passwordHash, scope: "PLATFORM", companyId: null, status: "ACTIVE",
        clearance: "RESTRICTED", passwordChangedAt: new Date() }).returning({ id: users.id });
      await writeAudit(tx, { companyId: null, actorId: null, action: "security.platform_admin_created", resourceType: "user", resourceId: u!.id });
      return "Platform Super Admin created.";
    });
    console.log(`${outcome} Two-factor authentication must be set up at first sign-in.`);
  } finally {
    await pool.end();
  }
}

main().catch((e: unknown) => {
  const msg = e instanceof Error ? ((e.cause as { message?: string } | undefined)?.message ?? e.message.split("\n")[0]!) : "unknown";
  console.error(`Stopped: ${msg.slice(0, 200)}`);
  process.exit(1);
});
