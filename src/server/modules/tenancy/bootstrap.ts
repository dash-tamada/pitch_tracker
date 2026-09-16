/**
 * Non-interactive helpers for scripts and automated tests (demo data, test tenants).
 * Production companies are created by the Super Admin through the platform UI/API instead.
 */
import { eq, inArray } from "drizzle-orm";
import type { Db } from "@/server/db/client";
import { companies, companyEmailDomains, roles, subscriptions, userRoles, users } from "@/server/db/schema";
import { hashPassword } from "@/server/modules/auth/password";
import { ensureCompanyDefaults, seedPlatform } from "./provision";

export async function ensureCompany(platformDb: Db, companyDbFor: (id: string) => Db,
  opts: { id?: string; code: string; name: string; planKey?: string; domains?: string[]; status?: "ACTIVE" | "TRIAL" }): Promise<string> {
  await seedPlatform(platformDb);
  let [c] = await platformDb.select({ id: companies.id }).from(companies).where(eq(companies.code, opts.code));
  if (!c) {
    [c] = await platformDb.insert(companies).values({ ...(opts.id ? { id: opts.id } : {}), code: opts.code, name: opts.name, status: opts.status ?? "ACTIVE",
      industry: "Film & Entertainment", setupCompletedAt: new Date() }).returning({ id: companies.id });
    await platformDb.insert(subscriptions).values({ companyId: c!.id, planKey: opts.planKey ?? "ENTERPRISE", status: "ACTIVE" });
    if (opts.domains?.length) await platformDb.insert(companyEmailDomains).values(opts.domains.map((domain) => ({ companyId: c!.id, domain })));
  }
  await ensureCompanyDefaults(companyDbFor(c!.id));
  return c!.id;
}

/** Creates an ACTIVE company user directly (tests/demo only). The password hash is written on the identity connection. */
export async function createActiveUser(platformDb: Db, companyDb: Db,
  u: { email: string; fullName: string; roleKeys: string[]; clearance?: "STANDARD" | "CONFIDENTIAL" | "RESTRICTED"; password?: string }): Promise<string> {
  const [row] = await companyDb.insert(users).values({ email: u.email.toLowerCase(), fullName: u.fullName, clearance: u.clearance ?? "CONFIDENTIAL", status: "ACTIVE" })
    .returning({ id: users.id });
  if (u.roleKeys.length) {
    const rs = await companyDb.select({ id: roles.id }).from(roles).where(inArray(roles.key, u.roleKeys));
    await companyDb.insert(userRoles).values(rs.map((r) => ({ userId: row!.id, roleId: r.id })));
  }
  if (u.password) await platformDb.update(users).set({ passwordHash: await hashPassword(u.password), passwordChangedAt: new Date() }).where(eq(users.id, row!.id));
  return row!.id;
}
