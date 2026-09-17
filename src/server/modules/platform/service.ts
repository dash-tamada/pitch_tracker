/**
 * Platform administration (Super Admin). Runs on the identity/platform connection (pitch_platform), which has
 * NO privileges on customer content: scripts, documents, pitches, creators, ratings, platform responses.
 *
 * Company provisioning and support views use the company-scoped connection for exactly one company id that the
 * Super Admin chose on the server; that is how a new company gets its defaults and first Company Admin.
 * Support views never include scripts, documents, pitch or creator content, require a live time-boxed grant with
 * a written reason, and are audited in both the platform trail and the company's own trail.
 */
import { and, asc, desc, eq, gt, inArray, isNull, lt, lte, or, sql } from "drizzle-orm";
import { z } from "zod";
import { tenantDb, withCompany, type Db } from "@/server/db/client";
import {
  auditLogs, companies, companyAllowedEmails, companyEmailDomains, plans, roles, sessions, subscriptionEvents, subscriptions,
  supportAccessGrants, systemSettings, userRoles, users,
} from "@/server/db/schema";
import { AppError, notFound } from "@/server/lib/errors";
import { decodeCursor, encodeCursor, parseInput } from "@/server/lib/validation";
import type { Actor } from "@/server/modules/authz/policy";
import { writeAudit, type RequestContext } from "@/server/modules/audit/service";
import { hashPassword, passwordPolicyErrors } from "@/server/modules/auth/password";
import { emailDomain, issueInvitation } from "@/server/modules/tenancy/invitations";
import { assertCanAddUser } from "@/server/modules/tenancy/limits";
import { ensureCompanyDefaults } from "@/server/modules/tenancy/provision";

export function requirePlatform(actor: Actor): void {
  if (actor.scope !== "PLATFORM" || actor.companyId !== null) throw new AppError("FORBIDDEN", "You do not have permission to do this.");
}

const DOMAIN = z.string().trim().toLowerCase().regex(/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/, "Enter a domain like example.com").max(253);
const CODE = z.string().trim().toUpperCase().regex(/^[A-Z][A-Z0-9]{1,11}$/, "2–12 capitals/digits, starting with a letter");
const COMPANY_STATUS = z.enum(["PENDING_SETUP", "TRIAL", "ACTIVE", "SUSPENDED", "EXPIRED", "ARCHIVED"]);
const SUB_STATUS = z.enum(["TRIAL", "ACTIVE", "PAST_DUE", "SUSPENDED", "EXPIRED", "CANCELLED"]);
const LIMITS = z.object({
  max_users: z.number().int().min(1).max(1_000_000).nullable().optional(),
  max_pitches: z.number().int().min(1).max(100_000_000).nullable().optional(),
  storage_bytes: z.number().int().min(0).max(10 * 1024 ** 5).nullable().optional(),
  max_file_bytes: z.number().int().min(1024).max(1024 ** 3).nullable().optional(),
}).strict();
const profileFields = {
  name: z.string().trim().min(2).max(160),
  legalName: z.string().trim().max(200).nullable().optional(),
  website: z.url({ protocol: /^https$/ }).max(500).nullable().optional(),
  industry: z.string().trim().max(120).nullable().optional(),
  country: z.string().trim().max(80).nullable().optional(),
  state: z.string().trim().max(80).nullable().optional(),
  city: z.string().trim().max(80).nullable().optional(),
  address: z.string().trim().max(1000).nullable().optional(),
  contactPerson: z.string().trim().max(120).nullable().optional(),
  contactPhone: z.string().regex(/^\+[1-9][0-9]{7,14}$/).nullable().optional(),
  primaryEmail: z.email().max(254).nullable().optional(),
  retentionDays: z.number().int().min(30).max(3650).optional(),
};

/* ───────────── Dashboard & companies ───────────── */

export async function platformOverview(db: Db, actor: Actor) {
  requirePlatform(actor);
  const [totals] = (await db.execute(sql`SELECT * FROM public.platform_totals()`)).rows as Record<string, unknown>[];
  const byStatus = await db.select({ status: companies.status, n: sql<number>`count(*)::int` }).from(companies).groupBy(companies.status);
  return { totals, byStatus };
}

export async function listCompanies(db: Db, actor: Actor) {
  requirePlatform(actor);
  const rows = await db.select({ id: companies.id, code: companies.code, name: companies.name, status: companies.status, createdAt: companies.createdAt,
    planKey: subscriptions.planKey, subscriptionStatus: subscriptions.status, endsOn: subscriptions.endsOn })
    .from(companies).leftJoin(subscriptions, eq(subscriptions.companyId, companies.id)).orderBy(asc(companies.name));
  const usage = (await db.execute(sql`SELECT * FROM public.platform_company_usage()`)).rows as { company_id: string; users_active: number; users_invited: number; pitches: number; storage_bytes: string; last_activity_at: string | null }[];
  const byId = new Map(usage.map((u) => [u.company_id, u]));
  return rows.map((r) => {
    const u = byId.get(r.id);
    return { ...r, usage: u ? { usersActive: u.users_active, usersInvited: u.users_invited, pitches: u.pitches, storageBytes: Number(u.storage_bytes), lastActivityAt: u.last_activity_at } : null };
  });
}

export async function getCompany(db: Db, actor: Actor, companyId: string) {
  requirePlatform(actor);
  const [company] = await db.select().from(companies).where(eq(companies.id, companyId));
  if (!company) throw notFound("Company");
  const [subscription] = await db.select().from(subscriptions).where(eq(subscriptions.companyId, companyId));
  const domains = (await db.select({ domain: companyEmailDomains.domain }).from(companyEmailDomains).where(eq(companyEmailDomains.companyId, companyId))).map((d) => d.domain);
  const exceptions = await db.select({ email: companyAllowedEmails.email, reason: companyAllowedEmails.reason, createdAt: companyAllowedEmails.createdAt })
    .from(companyAllowedEmails).where(eq(companyAllowedEmails.companyId, companyId));
  const events = await db.select().from(subscriptionEvents).where(eq(subscriptionEvents.companyId, companyId)).orderBy(desc(subscriptionEvents.createdAt)).limit(50);
  const grants = await db.select().from(supportAccessGrants).where(eq(supportAccessGrants.companyId, companyId)).orderBy(desc(supportAccessGrants.createdAt)).limit(20);
  const usage = ((await db.execute(sql`SELECT * FROM public.platform_company_usage() WHERE company_id = ${companyId}`)).rows[0] ?? null) as Record<string, unknown> | null;
  // Company Admins by name/email only (identity data), so the platform can see who to contact.
  const admins = await db.select({ id: users.id, email: users.email, fullName: users.fullName, status: users.status }).from(users)
    .innerJoin(userRoles, eq(userRoles.userId, users.id)).innerJoin(roles, eq(roles.id, userRoles.roleId))
    .where(and(eq(users.companyId, companyId), eq(roles.key, "COMPANY_ADMIN"), isNull(users.archivedAt)));
  return { company, subscription: subscription ?? null, domains, exceptions, events, grants, usage, admins };
}

export const createCompanySchema = z.object({
  code: CODE, ...profileFields,
  planKey: z.string().max(40),
  subscriptionStatus: z.enum(["TRIAL", "ACTIVE"]).default("TRIAL"),
  endsOn: z.iso.date().nullable().optional(),
  emailDomains: z.array(DOMAIN).max(20).default([]),
  adminEmail: z.email().max(254),
  adminFullName: z.string().trim().min(2).max(120),
  // Optional: set the first Company Admin's password directly instead of issuing an invitation link — useful
  // when no email provider is configured (e.g. local dev) so there is nothing to copy out of the server log.
  adminTempPassword: z.string().min(1).max(128).optional(),
}).strict();

/**
 * Creates a company, its subscription and email policy, provisions its defaults, and either invites its first
 * Company Admin (default) or, when adminTempPassword is given, creates that admin ACTIVE with the password set
 * directly (same two-step identity-connection write as createCompanyAdminWithPassword).
 * If provisioning fails after the company row is created, the company stays PENDING_SETUP and the error is returned; defaults provisioning is idempotent.
 */
export async function createCompany(db: Db, actor: Actor, raw: unknown, ctx: RequestContext = {}) {
  requirePlatform(actor);
  const input = parseInput(createCompanySchema, raw);
  const adminEmail = input.adminEmail.trim().toLowerCase();
  if (input.adminTempPassword) {
    const errors = passwordPolicyErrors(input.adminTempPassword, { email: adminEmail, fullName: input.adminFullName });
    if (errors.length) throw new AppError("VALIDATION", errors.join(" "), { adminTempPassword: errors[0]! });
  }
  const [plan] = await db.select({ key: plans.key }).from(plans).where(and(eq(plans.key, input.planKey), eq(plans.active, true)));
  if (!plan) throw new AppError("VALIDATION", "Choose an active plan.", { planKey: "Invalid" });
  if (input.endsOn && input.endsOn < new Date().toISOString().slice(0, 10)) throw new AppError("VALIDATION", "End date is in the past.", { endsOn: "Invalid" });

  let companyId: string;
  try {
    companyId = await db.transaction(async (tx) => {
      const [c] = await tx.insert(companies).values({ code: input.code, name: input.name, legalName: input.legalName ?? null, website: input.website ?? null,
        industry: input.industry ?? "Film & Entertainment", country: input.country ?? null, state: input.state ?? null, city: input.city ?? null,
        address: input.address ?? null, contactPerson: input.contactPerson ?? null, contactPhone: input.contactPhone ?? null,
        primaryEmail: input.primaryEmail ?? null, retentionDays: input.retentionDays ?? 365, status: "PENDING_SETUP", createdById: actor.userId })
        .returning({ id: companies.id });
      const id = c!.id;
      await tx.insert(subscriptions).values({ companyId: id, planKey: input.planKey, status: input.subscriptionStatus, endsOn: input.endsOn ?? null });
      await tx.insert(subscriptionEvents).values({ companyId: id, event: "created", after: { planKey: input.planKey, status: input.subscriptionStatus, endsOn: input.endsOn ?? null }, actorId: actor.userId });
      const domains = [...new Set(input.emailDomains)];
      if (domains.length) await tx.insert(companyEmailDomains).values(domains.map((domain) => ({ companyId: id, domain })));
      if (!domains.includes(emailDomain(adminEmail))) {
        await tx.insert(companyAllowedEmails).values({ companyId: id, email: adminEmail, reason: "First Company Admin, set by platform", approvedById: actor.userId });
      }
      await writeAudit(tx, { companyId: id, actorId: actor.userId, action: "company.created", resourceType: "company", resourceId: id,
        after: { code: input.code, name: input.name, planKey: input.planKey, subscriptionStatus: input.subscriptionStatus, domains } }, ctx);
      return id;
    });
  } catch (e) {
    if (pgCode(e) === "23505") throw new AppError("CONFLICT", "A company with this code already exists.", { code: "Taken" });
    throw e;
  }

  const invite = await provisionAndInvite(db, actor, companyId, adminEmail, input.adminFullName, input.subscriptionStatus === "ACTIVE" ? "ACTIVE" : "TRIAL", ctx, input.adminTempPassword);
  return { id: companyId, ...invite };
}

async function provisionAndInvite(
  db: Db, actor: Actor, companyId: string, adminEmail: string, adminFullName: string, finalStatus: "ACTIVE" | "TRIAL", ctx: RequestContext, tempPassword?: string,
) {
  const company = tenantDb(companyId);
  // password_hash can only be written on the identity connection (pitch_platform) — pitch_app is refused by a DB
  // trigger (defence in depth) — so hash it here and write it in a second step below, same as createCompanyAdminWithPassword.
  const passwordHash = tempPassword ? await hashPassword(tempPassword) : null;
  const { userId, invitePath } = await withCompany(companyId, async () => {
    await ensureCompanyDefaults(company);
    try {
      return await company.transaction(async (tx) => {
        const [u] = await tx.insert(users).values({ email: adminEmail, fullName: adminFullName, status: passwordHash ? "ACTIVE" : "INVITED", clearance: "RESTRICTED" })
          .returning({ id: users.id });
        const [role] = await tx.select({ id: roles.id }).from(roles).where(eq(roles.key, "COMPANY_ADMIN"));
        await tx.insert(userRoles).values({ userId: u!.id, roleId: role!.id });
        if (passwordHash) {
          await writeAudit(tx, { actorId: null, action: "user.invited_by_platform", resourceType: "user", resourceId: u!.id, after: { roles: ["COMPANY_ADMIN"], passwordSetDirectly: true } }, ctx);
          return { userId: u!.id, invitePath: null as string | null };
        }
        const token = await issueInvitation(tx, u!.id, null);
        await writeAudit(tx, { actorId: null, action: "user.invited_by_platform", resourceType: "user", resourceId: u!.id, after: { roles: ["COMPANY_ADMIN"] } }, ctx);
        return { userId: u!.id, invitePath: `/accept-invite#${token}` as string | null };
      });
    } catch (e) {
      if (pgCode(e) === "23505") throw new AppError("CONFLICT", "The Company Admin email address cannot be used. It may already be registered.", { adminEmail: "Unavailable" });
      throw e;
    }
  });
  if (passwordHash) {
    // passwordChangedAt stays null: forces a password change on first sign-in (enforced server-side), same as createCompanyAdminWithPassword.
    await db.update(users).set({ passwordHash, passwordChangedAt: null }).where(eq(users.id, userId));
  }
  await db.update(companies).set({ status: finalStatus, setupCompletedAt: null }).where(eq(companies.id, companyId));
  await writeAudit(db, { companyId, actorId: actor.userId, action: "company.provisioned", resourceType: "company", resourceId: companyId, after: { status: finalStatus } }, ctx);
  return { invitePath };
}

export const updateCompanySchema = z.object({ ...profileFields, name: profileFields.name.optional() }).strict();

export async function updateCompany(db: Db, actor: Actor, companyId: string, raw: unknown, ctx: RequestContext = {}) {
  requirePlatform(actor);
  const input = parseInput(updateCompanySchema, raw);
  return db.transaction(async (tx) => {
    const [before] = await tx.select().from(companies).where(eq(companies.id, companyId)).for("update");
    if (!before) throw notFound("Company");
    await tx.update(companies).set(input).where(eq(companies.id, companyId));
    await writeAudit(tx, { companyId, actorId: actor.userId, action: "company.updated", resourceType: "company", resourceId: companyId,
      before: Object.fromEntries(Object.keys(input).map((k) => [k, before[k as keyof typeof before]])), after: input }, ctx);
    return { id: companyId };
  });
}

export const createAdminWithPasswordSchema = z.object({
  email: z.email().max(254),
  fullName: z.string().trim().min(2).max(120),
  tempPassword: z.string().min(1).max(128),
}).strict();

/**
 * Bootstraps (or adds) a Company Admin directly with an email and a temp password chosen by the Super Admin,
 * instead of the usual invitation link. The account is ACTIVE immediately; passwordChangedAt is left null,
 * which forces a password change on first sign-in (enforced server-side — see auth/service.ts, http.ts's route()
 * gate and page-session.ts) before that admin can do anything, including inviting the rest of their company.
 *
 * pitch_app (the company connection) is not allowed to set password_hash at all (DB trigger, defence in depth),
 * so the user row is created via the company connection with no password, then the password is written in a
 * second step through the identity connection (pitch_platform), which is the only role permitted to do so.
 */
export async function createCompanyAdminWithPassword(db: Db, actor: Actor, companyId: string, raw: unknown, ctx: RequestContext = {}) {
  requirePlatform(actor);
  const input = parseInput(createAdminWithPasswordSchema, raw);
  const email = input.email.trim().toLowerCase();
  const errors = passwordPolicyErrors(input.tempPassword, { email, fullName: input.fullName });
  if (errors.length) throw new AppError("VALIDATION", errors.join(" "), { tempPassword: errors[0]! });
  const [company] = await db.select({ id: companies.id }).from(companies).where(eq(companies.id, companyId));
  if (!company) throw notFound("Company");
  // Checked on the identity connection, which (unlike the company-scoped one) can see every account regardless of
  // scope or company — a company connection's view of `users` is limited by RLS to its own company, so it would
  // miss a clash with, say, a platform (Super Admin) account or an employee of a different company.
  const [existingAnywhere] = await db.select({ id: users.id }).from(users).where(eq(users.email, email));
  if (existingAnywhere) throw new AppError("CONFLICT", "This email address cannot be used. It may already be registered.", { email: "Unavailable" });

  const passwordHash = await hashPassword(input.tempPassword);
  const tenant = tenantDb(companyId);
  const userId = await withCompany(companyId, async () => {
    await ensureCompanyDefaults(tenant);
    try {
      return await tenant.transaction(async (tx) => {
        await assertCanAddUser(tx);
        // The platform is vouching for this address directly; it does not need to match the company's domain policy.
        await tx.insert(companyAllowedEmails).values({ companyId, email, reason: "Company Admin added directly by platform", approvedById: actor.userId }).onConflictDoNothing();
        const [u] = await tx.insert(users).values({ email, fullName: input.fullName, status: "ACTIVE", clearance: "RESTRICTED" }).returning({ id: users.id });
        const [role] = await tx.select({ id: roles.id }).from(roles).where(eq(roles.key, "COMPANY_ADMIN"));
        if (!role) throw new AppError("INTERNAL", "This company has no Company Admin role yet.");
        // grantedById is left unset: it has a composite FK to (company_id, id) on users, and the platform actor
        // creating this belongs to no company at all — the same reason provisionAndInvite (first-admin creation
        // at company sign-up) also omits it. Setting it to the Super Admin's own id violates that FK every time.
        await tx.insert(userRoles).values({ userId: u!.id, roleId: role.id });
        return u!.id;
      });
    } catch (e) {
      if (pgCode(e) === "23505") throw new AppError("CONFLICT", "This email address cannot be used. It may already be registered.", { email: "Unavailable" });
      throw e;
    }
  });
  // Identity fields (password_hash, password_changed_at) can only be written on the identity connection.
  await db.update(users).set({ passwordHash, passwordChangedAt: null }).where(eq(users.id, userId));
  await writeAudit(db, { companyId, actorId: actor.userId, action: "platform.company_admin_created_with_temp_password", resourceType: "user", resourceId: userId,
    after: { email, fullName: input.fullName } }, ctx); // never audit the password itself
  return { id: userId, email };
}

const statusSchema = z.object({ status: COMPANY_STATUS, reason: z.string().trim().min(5).max(300) }).strict();
const LOCKING = new Set(["SUSPENDED", "EXPIRED", "ARCHIVED"]);

/** Suspending/expiring/archiving immediately revokes every session of that company's users. */
export async function setCompanyStatus(db: Db, actor: Actor, companyId: string, raw: unknown, ctx: RequestContext = {}) {
  requirePlatform(actor);
  const { status, reason } = parseInput(statusSchema, raw);
  return db.transaction(async (tx) => {
    const [before] = await tx.select({ status: companies.status }).from(companies).where(eq(companies.id, companyId)).for("update");
    if (!before) throw notFound("Company");
    if (before.status === "ARCHIVED" && status !== "ARCHIVED") throw new AppError("CONFLICT", "Archived companies cannot be reactivated here.");
    const now = new Date();
    await tx.update(companies).set({ status, statusReason: reason, suspendedAt: status === "SUSPENDED" ? now : null, archivedAt: status === "ARCHIVED" ? now : null })
      .where(eq(companies.id, companyId));
    let revoked = 0;
    if (LOCKING.has(status)) {
      const r = await tx.update(sessions).set({ revokedAt: now })
        .where(and(isNull(sessions.revokedAt), inArray(sessions.userId, tx.select({ id: users.id }).from(users).where(eq(users.companyId, companyId)))))
        .returning({ id: sessions.id });
      revoked = r.length;
    }
    await writeAudit(tx, { companyId, actorId: actor.userId, action: "company.status_changed", resourceType: "company", resourceId: companyId,
      before: { status: before.status }, after: { status, reason, sessionsRevoked: revoked } }, ctx);
    return { id: companyId, status, sessionsRevoked: revoked };
  });
}

const subscriptionSchema = z.object({
  planKey: z.string().max(40).optional(), status: SUB_STATUS.optional(), endsOn: z.iso.date().nullable().optional(), limitOverrides: LIMITS.optional(),
}).strict();

export async function updateSubscription(db: Db, actor: Actor, companyId: string, raw: unknown, ctx: RequestContext = {}) {
  requirePlatform(actor);
  const input = parseInput(subscriptionSchema, raw);
  return db.transaction(async (tx) => {
    const [before] = await tx.select().from(subscriptions).where(eq(subscriptions.companyId, companyId)).for("update");
    if (!before) throw notFound("Subscription");
    if (input.planKey) {
      const [p] = await tx.select({ key: plans.key }).from(plans).where(and(eq(plans.key, input.planKey), eq(plans.active, true)));
      if (!p) throw new AppError("VALIDATION", "Choose an active plan.", { planKey: "Invalid" });
    }
    await tx.update(subscriptions).set(input).where(eq(subscriptions.id, before.id));
    const after = { planKey: input.planKey ?? before.planKey, status: input.status ?? before.status, endsOn: input.endsOn === undefined ? before.endsOn : input.endsOn,
      limitOverrides: input.limitOverrides ?? before.limitOverrides };
    await tx.insert(subscriptionEvents).values({ companyId, event: "updated", actorId: actor.userId,
      before: { planKey: before.planKey, status: before.status, endsOn: before.endsOn, limitOverrides: before.limitOverrides }, after });
    await writeAudit(tx, { companyId, actorId: actor.userId, action: "company.subscription_changed", resourceType: "company", resourceId: companyId, after }, ctx);
    return after;
  });
}

export async function setEmailDomains(db: Db, actor: Actor, companyId: string, raw: unknown, ctx: RequestContext = {}) {
  requirePlatform(actor);
  const { domains } = parseInput(z.object({ domains: z.array(DOMAIN).max(20) }).strict(), raw);
  const unique = [...new Set(domains)];
  return db.transaction(async (tx) => {
    const [c] = await tx.select({ id: companies.id }).from(companies).where(eq(companies.id, companyId));
    if (!c) throw notFound("Company");
    const before = (await tx.select({ d: companyEmailDomains.domain }).from(companyEmailDomains).where(eq(companyEmailDomains.companyId, companyId))).map((r) => r.d);
    await tx.delete(companyEmailDomains).where(eq(companyEmailDomains.companyId, companyId));
    if (unique.length) await tx.insert(companyEmailDomains).values(unique.map((domain) => ({ companyId, domain })));
    await writeAudit(tx, { companyId, actorId: actor.userId, action: "company.email_domains_changed", resourceType: "company", resourceId: companyId, before: { domains: before }, after: { domains: unique } }, ctx);
    return { domains: unique };
  });
}

/* ───────────── Plans ───────────── */

export async function listPlans(db: Db, actor: Actor) {
  requirePlatform(actor);
  return db.select().from(plans).orderBy(asc(plans.sortOrder));
}

const planSchema = z.object({
  key: z.string().trim().toUpperCase().regex(/^[A-Z][A-Z0-9_]{1,39}$/), name: z.string().trim().min(2).max(80),
  description: z.string().trim().max(1000).nullable().optional(), limits: LIMITS, active: z.boolean().default(true), sortOrder: z.number().int().min(0).max(1000).default(0),
}).strict();

export async function upsertPlan(db: Db, actor: Actor, raw: unknown, ctx: RequestContext = {}) {
  requirePlatform(actor);
  const input = parseInput(planSchema, raw);
  await db.transaction(async (tx) => {
    const [before] = await tx.select().from(plans).where(eq(plans.key, input.key));
    await tx.insert(plans).values(input).onConflictDoUpdate({ target: plans.key,
      set: { name: input.name, description: input.description ?? null, limits: input.limits, active: input.active, sortOrder: input.sortOrder } });
    await writeAudit(tx, { companyId: null, actorId: actor.userId, action: before ? "platform.plan_updated" : "platform.plan_created", resourceType: "plan", before: before ?? undefined, after: input }, ctx);
  });
  return { key: input.key };
}

/* ───────────── Platform audit ───────────── */

const auditQuery = z.object({
  action: z.string().max(80).regex(/^[a-z_.]*$/).optional(), companyId: z.uuid().optional(),
  from: z.iso.date().optional(), to: z.iso.date().optional(), cursor: z.string().max(200).optional(),
}).strict();

/** Row-level security limits pitch_platform to platform, sign-in, security, company and support events. */
export async function platformAudit(db: Db, actor: Actor, raw: unknown) {
  requirePlatform(actor);
  const q = parseInput(auditQuery, raw);
  const cursor = decodeCursor(q.cursor);
  const where = and(
    q.action ? sql`${auditLogs.action} LIKE ${q.action.replaceAll("_", "\\_") + "%"}` : undefined,
    q.companyId ? eq(auditLogs.companyId, q.companyId) : undefined,
    q.from ? sql`${auditLogs.createdAt} >= ${q.from}::date` : undefined,
    q.to ? sql`${auditLogs.createdAt} < (${q.to}::date + 1)` : undefined,
    cursor ? or(lt(auditLogs.createdAt, cursor.createdAt), and(eq(auditLogs.createdAt, cursor.createdAt), lt(auditLogs.id, cursor.id))) : undefined,
  );
  const rows = await db.select({ id: auditLogs.id, createdAt: auditLogs.createdAt, action: auditLogs.action, companyId: auditLogs.companyId, companyCode: companies.code,
    actorId: auditLogs.actorId, actorEmail: users.email, resourceType: auditLogs.resourceType, resourceId: auditLogs.resourceId, ip: auditLogs.ip, after: auditLogs.after })
    .from(auditLogs).leftJoin(companies, eq(companies.id, auditLogs.companyId)).leftJoin(users, eq(users.id, auditLogs.actorId))
    .where(where).orderBy(desc(auditLogs.createdAt), desc(auditLogs.id)).limit(101);
  const items = rows.slice(0, 100);
  return { items, nextCursor: rows.length > 100 ? encodeCursor(items.at(-1)!.createdAt, items.at(-1)!.id) : null };
}

/* ───────────── Support access ───────────── */

const grantSchema = z.object({ reason: z.string().trim().min(10).max(500), minutes: z.number().int().min(5).max(240).default(60) }).strict();

export async function requestSupportAccess(db: Db, actor: Actor, companyId: string, raw: unknown, ctx: RequestContext = {}) {
  requirePlatform(actor);
  const { reason, minutes } = parseInput(grantSchema, raw);
  const [c] = await db.select({ id: companies.id }).from(companies).where(eq(companies.id, companyId));
  if (!c) throw notFound("Company");
  const now = new Date();
  const [g] = await db.insert(supportAccessGrants).values({ companyId, platformUserId: actor.userId, reason, startsAt: now, expiresAt: new Date(now.getTime() + minutes * 60_000) })
    .returning({ id: supportAccessGrants.id, expiresAt: supportAccessGrants.expiresAt });
  await writeAudit(db, { companyId, actorId: actor.userId, action: "support.access_granted", resourceType: "company", resourceId: companyId, after: { grantId: g!.id, reason, minutes } }, ctx);
  return g!;
}

export async function revokeSupportAccess(db: Db, actor: Actor, grantId: string, ctx: RequestContext = {}) {
  requirePlatform(actor);
  const [g] = await db.update(supportAccessGrants).set({ revokedAt: new Date() })
    .where(and(eq(supportAccessGrants.id, grantId), isNull(supportAccessGrants.revokedAt))).returning({ companyId: supportAccessGrants.companyId });
  if (!g) throw notFound("Support access");
  await writeAudit(db, { companyId: g.companyId, actorId: actor.userId, action: "support.access_revoked", resourceType: "company", resourceId: g.companyId, after: { grantId } }, ctx);
  return { ok: true };
}

/**
 * Read-only support view of a company's configuration: users (no credentials), roles, settings, recent company audit.
 * Never pitches, creators, documents, ratings or platform responses.
 */
export async function supportView(db: Db, actor: Actor, companyId: string, ctx: RequestContext = {}) {
  requirePlatform(actor);
  const now = new Date();
  const [grant] = await db.select({ id: supportAccessGrants.id, expiresAt: supportAccessGrants.expiresAt }).from(supportAccessGrants)
    .where(and(eq(supportAccessGrants.companyId, companyId), eq(supportAccessGrants.platformUserId, actor.userId), isNull(supportAccessGrants.revokedAt),
      lte(supportAccessGrants.startsAt, now), gt(supportAccessGrants.expiresAt, now)))
    .orderBy(desc(supportAccessGrants.expiresAt)).limit(1);
  if (!grant) throw new AppError("FORBIDDEN", "Request support access with a reason first.");
  const data = await withCompany(companyId, async () => {
    const company = tenantDb(companyId);
    const people = await company.select({ id: users.id, email: users.email, fullName: users.fullName, status: users.status, mfaEnabled: users.mfaEnabled,
      lastLoginAt: users.lastLoginAt, lockedUntil: users.lockedUntil,
      roles: sql<string[]>`coalesce((SELECT array_agg(r.key ORDER BY r.key) FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = "users"."id"), '{}')` })
      .from(users).where(isNull(users.archivedAt)).orderBy(asc(users.fullName));
    const roleRows = await company.select({ key: roles.key, name: roles.name }).from(roles).orderBy(asc(roles.key));
    const settings = await company.select({ key: systemSettings.key, value: systemSettings.value }).from(systemSettings);
    const recent = await company.select({ createdAt: auditLogs.createdAt, action: auditLogs.action, actorId: auditLogs.actorId, resourceType: auditLogs.resourceType })
      .from(auditLogs).orderBy(desc(auditLogs.createdAt)).limit(100);
    return { people, roles: roleRows, settings, recentActivity: recent };
  });
  // One entry, owned by the company: visible in the company's own audit trail and in the platform trail.
  await writeAudit(db, { companyId, actorId: actor.userId, action: "support.viewed", resourceType: "company", resourceId: companyId, after: { grantId: grant.id } }, ctx);
  return { grant, ...data };
}

/* ───────────── Scheduled ───────────── */

/** Daily: subscriptions past their end date expire, and their companies lose access. */
export async function expireSubscriptions(db: Db, today = new Date().toISOString().slice(0, 10)) {
  const due = await db.select({ companyId: subscriptions.companyId, status: subscriptions.status }).from(subscriptions)
    .where(and(lt(subscriptions.endsOn, today), inArray(subscriptions.status, ["TRIAL", "ACTIVE", "PAST_DUE"])));
  for (const d of due) {
    await db.transaction(async (tx) => {
      await tx.update(subscriptions).set({ status: "EXPIRED" }).where(eq(subscriptions.companyId, d.companyId));
      await tx.insert(subscriptionEvents).values({ companyId: d.companyId, event: "expired", before: { status: d.status }, after: { status: "EXPIRED" } });
      await tx.update(companies).set({ status: "EXPIRED", statusReason: "Subscription ended" }).where(and(eq(companies.id, d.companyId), inArray(companies.status, ["TRIAL", "ACTIVE", "PENDING_SETUP"])));
      await tx.update(sessions).set({ revokedAt: new Date() })
        .where(and(isNull(sessions.revokedAt), inArray(sessions.userId, tx.select({ id: users.id }).from(users).where(eq(users.companyId, d.companyId)))));
      await writeAudit(tx, { companyId: d.companyId, actorId: null, action: "company.subscription_expired", resourceType: "company", resourceId: d.companyId }, {});
    });
  }
  return { expired: due.length };
}

function pgCode(e: unknown): string | undefined {
  return (e as { cause?: { code?: string } }).cause?.code ?? (e as { code?: string }).code;
}
