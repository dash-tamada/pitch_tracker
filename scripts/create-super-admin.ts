/**
 * Bootstraps the first Super Admin.
 * Usage: BOOTSTRAP_ADMIN_PASSWORD='…' npx tsx scripts/create-super-admin.ts admin@company.com "Full Name"
 * The password is read from the environment (set it only for this command) and is never printed.
 */
import { eq } from "drizzle-orm";
import { createDb } from "../src/server/db/client";
import { roles, userRoles, users } from "../src/server/db/schema";
import { hashPassword, passwordPolicyErrors } from "../src/server/modules/auth/password";
import { writeAudit } from "../src/server/modules/audit/service";

async function main() {
  const [email, fullName] = process.argv.slice(2);
  const password = process.env.BOOTSTRAP_ADMIN_PASSWORD ?? "";
  if (!email || !fullName) throw new Error('Usage: create-super-admin.ts <email> "<full name>"');
  const errors = passwordPolicyErrors(password, { email });
  if (errors.length) throw new Error(`Password rejected: ${errors.join(" ")}`);
  const { db, pool } = createDb(process.env.DATABASE_URL!, 1);
  try {
    await db.transaction(async (tx) => {
      const [role] = await tx.select({ id: roles.id }).from(roles).where(eq(roles.key, "SUPER_ADMIN"));
      if (!role) throw new Error("Run the configuration seed first.");
      const [u] = await tx.insert(users).values({ email: email.toLowerCase(), fullName, passwordHash: await hashPassword(password),
        clearance: "RESTRICTED", passwordChangedAt: new Date() }).returning({ id: users.id });
      await tx.insert(userRoles).values({ userId: u!.id, roleId: role.id });
      await writeAudit(tx, { actorId: null, action: "user.bootstrap_super_admin", resourceType: "user", resourceId: u!.id });
    });
    console.log("Super Admin created. They must enrol MFA at first sign-in.");
  } finally {
    await pool.end();
  }
}
main().catch((e: unknown) => { console.error(e instanceof Error ? ((e.cause as { message?: string } | undefined)?.message ?? e.message.split("\n")[0]!.slice(0, 200)) : "unknown"); process.exit(1); });
