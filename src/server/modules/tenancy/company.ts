/**
 * The signed-in company's own profile, branding, plan usage and email exceptions (Company Admin).
 * Company-scoped connection: row-level security returns only the caller's company row; column grants allow
 * only profile/branding columns to change (never status, plan, code or retention).
 */
import { and, asc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/server/db/client";
import { companies, companyAllowedEmails, companyEmailDomains, plans, subscriptions, users } from "@/server/db/schema";
import { AppError, notFound } from "@/server/lib/errors";
import { parseInput } from "@/server/lib/validation";
import { requirePermission, type Actor } from "@/server/modules/authz/policy";
import { writeAudit, type RequestContext } from "@/server/modules/audit/service";
import { companyLimits, storageUsedBytes } from "./limits";

const selfId = sql`public.app_company_id()`;

/** Minimal branding for every signed-in page. */
export async function companyBranding(db: Db) {
  const [c] = await db.select({ name: companies.name, code: companies.code, color: companies.brandPrimaryColor, setupCompletedAt: companies.setupCompletedAt, status: companies.status })
    .from(companies).where(eq(companies.id, selfId));
  return c ?? null;
}

export async function getMyCompany(db: Db, actor: Actor) {
  requirePermission(actor, "company.manage");
  const [company] = await db.select({ id: companies.id, code: companies.code, name: companies.name, legalName: companies.legalName, pitchCodePrefix: companies.pitchCodePrefix,
    brandPrimaryColor: companies.brandPrimaryColor, website: companies.website, industry: companies.industry, country: companies.country, state: companies.state,
    city: companies.city, address: companies.address, contactPerson: companies.contactPerson, contactPhone: companies.contactPhone, primaryEmail: companies.primaryEmail,
    status: companies.status, setupCompletedAt: companies.setupCompletedAt, retentionDays: companies.retentionDays })
    .from(companies).where(eq(companies.id, selfId));
  if (!company) throw notFound("Company");
  const { limits, subscriptionStatus, planKey } = await companyLimits(db);
  const [plan] = planKey ? await db.select({ name: plans.name }).from(plans).where(eq(plans.key, planKey)) : [];
  const [sub] = await db.select({ endsOn: subscriptions.endsOn }).from(subscriptions).where(eq(subscriptions.companyId, selfId));
  const [u] = await db.select({ active: sql<number>`count(*) FILTER (WHERE status = 'ACTIVE')::int`, invited: sql<number>`count(*) FILTER (WHERE status = 'INVITED')::int` })
    .from(users).where(sql`${users.archivedAt} IS NULL`);
  const domains = (await db.select({ d: companyEmailDomains.domain }).from(companyEmailDomains).orderBy(asc(companyEmailDomains.domain))).map((r) => r.d);
  const exceptions = await db.select({ email: companyAllowedEmails.email, reason: companyAllowedEmails.reason, createdAt: companyAllowedEmails.createdAt })
    .from(companyAllowedEmails).orderBy(asc(companyAllowedEmails.email));
  return { company, subscription: { planKey, planName: plan?.name ?? null, status: subscriptionStatus, endsOn: sub?.endsOn ?? null, limits },
    usage: { usersActive: u?.active ?? 0, usersInvited: u?.invited ?? 0, storageBytes: await storageUsedBytes(db) }, domains, exceptions };
}

const opt = (max: number) => z.string().trim().max(max).nullable().optional();
export const updateMyCompanySchema = z.object({
  name: z.string().trim().min(2).max(160).optional(), legalName: opt(200),
  pitchCodePrefix: z.string().trim().toUpperCase().regex(/^[A-Z][A-Z0-9]{1,11}$/).nullable().optional(),
  brandPrimaryColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/).nullable().optional(),
  website: z.url({ protocol: /^https$/ }).max(500).nullable().optional(),
  industry: opt(120), country: opt(80), state: opt(80), city: opt(80), address: opt(1000), contactPerson: opt(120),
  contactPhone: z.string().regex(/^\+[1-9][0-9]{7,14}$/).nullable().optional(), primaryEmail: z.email().max(254).nullable().optional(),
  completeSetup: z.literal(true).optional(),
}).strict();

export async function updateMyCompany(db: Db, actor: Actor, raw: unknown, ctx: RequestContext = {}) {
  requirePermission(actor, "company.manage");
  const { completeSetup, ...input } = parseInput(updateMyCompanySchema, raw);
  return db.transaction(async (tx) => {
    const [before] = await tx.select({ name: companies.name, brandPrimaryColor: companies.brandPrimaryColor, pitchCodePrefix: companies.pitchCodePrefix, setupCompletedAt: companies.setupCompletedAt })
      .from(companies).where(eq(companies.id, selfId));
    if (!before) throw notFound("Company");
    const patch = { ...input, ...(completeSetup && !before.setupCompletedAt ? { setupCompletedAt: new Date() } : {}) };
    if (Object.keys(patch).length) await tx.update(companies).set(patch).where(eq(companies.id, selfId));
    await writeAudit(tx, { actorId: actor.userId, action: completeSetup ? "company.setup_completed" : "company.profile_updated", resourceType: "company",
      before, after: patch }, ctx);
    return { ok: true };
  });
}

const exceptionSchema = z.object({ email: z.email().max(254), reason: z.string().trim().min(5).max(300) }).strict();

/** Allows one exact address outside the company domains (e.g. a consultant). Audited; the reason is mandatory. */
export async function addEmailException(db: Db, actor: Actor, raw: unknown, ctx: RequestContext = {}) {
  requirePermission(actor, "company.manage");
  const { email, reason } = parseInput(exceptionSchema, raw);
  const normalized = email.trim().toLowerCase();
  await db.transaction(async (tx) => {
    await tx.insert(companyAllowedEmails).values({ email: normalized, reason, approvedById: actor.userId }).onConflictDoNothing();
    await writeAudit(tx, { actorId: actor.userId, action: "security.email_exception_added", resourceType: "company", after: { email: normalized, reason } }, ctx);
  });
  return { email: normalized };
}

export async function removeEmailException(db: Db, actor: Actor, raw: unknown, ctx: RequestContext = {}) {
  requirePermission(actor, "company.manage");
  const { email } = parseInput(z.object({ email: z.email().max(254) }).strict(), raw);
  const normalized = email.trim().toLowerCase();
  await db.transaction(async (tx) => {
    const r = await tx.delete(companyAllowedEmails).where(and(eq(companyAllowedEmails.email, normalized))).returning({ email: companyAllowedEmails.email });
    if (!r.length) throw new AppError("NOT_FOUND", "Exception not found.");
    await writeAudit(tx, { actorId: actor.userId, action: "security.email_exception_removed", resourceType: "company", after: { email: normalized } }, ctx);
  });
  return { ok: true };
}
