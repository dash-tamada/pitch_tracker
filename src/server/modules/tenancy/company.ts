/**
 * The signed-in company's own profile, branding, plan usage and email exceptions (Company Admin).
 * Company-scoped connection: row-level security returns only the caller's company row; column grants allow
 * only profile/branding columns to change (never status, plan, code or retention).
 */
import { randomUUID, createHash } from "node:crypto";
import { and, asc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/server/db/client";
import { companies, companyAllowedEmails, companyEmailDomains, plans, subscriptions, users } from "@/server/db/schema";
import { AppError, notFound } from "@/server/lib/errors";
import { parseInput } from "@/server/lib/validation";
import { requirePermission, type Actor } from "@/server/modules/authz/policy";
import { writeAudit, type RequestContext } from "@/server/modules/audit/service";
import { hashToken, newToken } from "@/server/modules/auth/tokens";
import { IMAGE_TYPES, detectAndValidate, extensionOf } from "@/server/modules/storage/file-type";
import { SIGNED_URL_TTL_SECONDS } from "@/server/modules/storage";
import type { StoragePort } from "@/server/modules/storage/port";
import { companyLimits, storageUsedBytes } from "./limits";

const selfId = sql`public.app_company_id()`;

/** Minimal branding for every signed-in page. */
export async function companyBranding(db: Db) {
  const [c] = await db.select({ name: companies.name, code: companies.code, color: companies.brandPrimaryColor, logoKey: companies.logoKey,
    setupCompletedAt: companies.setupCompletedAt, status: companies.status })
    .from(companies).where(eq(companies.id, selfId));
  return c ?? null;
}

/** Short-lived read URL for the sidebar/company page — logoKey is a private storage key, never a public URL. */
export async function companyLogoUrl(db: Db, storage: StoragePort, logoKey: string | null): Promise<string | null> {
  if (!logoKey) return null;
  return storage.createSignedReadUrl(logoKey, SIGNED_URL_TTL_SECONDS() * 5, undefined, { inline: true });
}

const MAX_LOGO_BYTES = 2 * 1024 * 1024; // a sidebar/header mark, not a document — kept small deliberately

/**
 * Logo upload, mirroring documents/service.ts's quarantine-and-validate flow (issue a single-object signed
 * URL into quarantine → browser PUTs the file → this re-reads the bytes itself and content-sniffs them)
 * but self-contained here rather than added to upload_intents: that table's kind enum and its
 * upload_intents_target_ck constraint are a database migration, and this task is scoped to application code
 * only. Nothing is trusted about the quarantine key it is handed back except that it was one this same
 * function issued to this same company (the quarantine path is namespaced by company id and a random UUID,
 * so it cannot be guessed or reused across companies).
 */
export async function createLogoUploadUrl(db: Db, actor: Actor, storage: StoragePort, raw: unknown) {
  requirePermission(actor, "company.manage");
  const { filename, sizeBytes } = parseInput(z.object({ filename: z.string().trim().min(1).max(255), sizeBytes: z.number().int().min(1) }).strict(), raw);
  const ext = extensionOf(filename);
  if (!(ext in IMAGE_TYPES)) throw new AppError("VALIDATION", `Allowed file types: ${[...new Set(Object.keys(IMAGE_TYPES))].join(", ").toUpperCase()}.`, { filename: "Type not allowed" });
  if (sizeBytes > MAX_LOGO_BYTES) throw new AppError("VALIDATION", `File is larger than ${Math.round(MAX_LOGO_BYTES / 1048576)} MB.`, { sizeBytes: "Too large" });
  if (!actor.companyId) throw new AppError("FORBIDDEN", "You do not have permission to do this.");
  const quarantineKey = `company/${actor.companyId}/logo/quarantine/${randomUUID()}.${ext}`;
  const { url } = await storage.createSignedUploadUrl(quarantineKey);
  return { uploadUrl: url, quarantineKey, maxBytes: MAX_LOGO_BYTES };
}

const completeLogoSchema = z.object({
  quarantineKey: z.string().trim().min(1).max(300), filename: z.string().trim().min(1).max(255), sizeBytes: z.number().int().min(1),
}).strict();

export async function completeLogoUpload(db: Db, actor: Actor, storage: StoragePort, raw: unknown, ctx: RequestContext = {}) {
  requirePermission(actor, "company.manage");
  const input = parseInput(completeLogoSchema, raw);
  if (!actor.companyId) throw new AppError("FORBIDDEN", "You do not have permission to do this.");
  // The key must be one this actor's own createLogoUploadUrl call could have produced — never trust a
  // client-supplied storage key otherwise (it would let one company move/read another's objects by guessing
  // or reusing a path).
  const prefix = `company/${actor.companyId}/logo/quarantine/`;
  if (!input.quarantineKey.startsWith(prefix) || !/^[0-9a-f-]{36}\.[a-z0-9]{1,5}$/.test(input.quarantineKey.slice(prefix.length))) {
    throw new AppError("VALIDATION", "Invalid upload.");
  }
  if (input.sizeBytes > MAX_LOGO_BYTES) throw new AppError("VALIDATION", `File is larger than ${Math.round(MAX_LOGO_BYTES / 1048576)} MB.`, { sizeBytes: "Too large" });

  let bytes: Buffer | null;
  try { bytes = await storage.download(input.quarantineKey, MAX_LOGO_BYTES); } catch { throw new AppError("VALIDATION", `File is larger than ${Math.round(MAX_LOGO_BYTES / 1048576)} MB.`); }
  if (!bytes) throw new AppError("VALIDATION", "The file has not finished uploading.");
  const verdict = detectAndValidate(bytes, input.filename, IMAGE_TYPES);
  if (!verdict.ok) {
    await storage.remove([input.quarantineKey]).catch(() => undefined);
    throw new AppError("VALIDATION", verdict.reason, { file: verdict.reason });
  }
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const finalKey = `company/${actor.companyId}/logo/logo-${randomUUID()}.${verdict.type.ext}`;
  await storage.move(input.quarantineKey, finalKey);
  try {
    const old = await db.transaction(async (tx) => {
      const [before] = await tx.select({ logoKey: companies.logoKey }).from(companies).where(eq(companies.id, selfId)).for("update");
      await tx.update(companies).set({ logoKey: finalKey }).where(eq(companies.id, selfId));
      await writeAudit(tx, { actorId: actor.userId, action: "company.logo_updated", resourceType: "company", before: { logoKey: before?.logoKey ?? null }, after: { logoKey: finalKey, sha256 } }, ctx);
      return before?.logoKey ?? null;
    });
    if (old) await storage.remove([old]).catch(() => undefined);
  } catch (e) {
    await storage.remove([finalKey]).catch(() => undefined);
    throw e;
  }
  return { ok: true };
}

export async function removeCompanyLogo(db: Db, actor: Actor, storage: StoragePort, ctx: RequestContext = {}) {
  requirePermission(actor, "company.manage");
  const old = await db.transaction(async (tx) => {
    const [before] = await tx.select({ logoKey: companies.logoKey }).from(companies).where(eq(companies.id, selfId)).for("update");
    if (!before?.logoKey) return null;
    await tx.update(companies).set({ logoKey: null }).where(eq(companies.id, selfId));
    await writeAudit(tx, { actorId: actor.userId, action: "company.logo_removed", resourceType: "company", before: { logoKey: before.logoKey } }, ctx);
    return before.logoKey;
  });
  if (old) await storage.remove([old]).catch(() => undefined);
  return { ok: true };
}

export async function getMyCompany(db: Db, actor: Actor) {
  requirePermission(actor, "company.manage");
  const [row] = await db.select({ id: companies.id, code: companies.code, name: companies.name, legalName: companies.legalName, pitchCodePrefix: companies.pitchCodePrefix,
    brandPrimaryColor: companies.brandPrimaryColor, logoKey: companies.logoKey, website: companies.website, industry: companies.industry, country: companies.country, state: companies.state,
    city: companies.city, address: companies.address, contactPerson: companies.contactPerson, contactPhone: companies.contactPhone, primaryEmail: companies.primaryEmail,
    status: companies.status, setupCompletedAt: companies.setupCompletedAt, retentionDays: companies.retentionDays })
    .from(companies).where(eq(companies.id, selfId));
  if (!row) throw notFound("Company");
  // logoKey is a private storage key, never handed to a browser as-is (see companyLogoUrl's own note) — it
  // never leaves this function; callers that need to render the logo call companyLogoUrl with it directly.
  const { logoKey, ...company } = row;
  const { limits, subscriptionStatus, planKey } = await companyLimits(db);
  const [plan] = planKey ? await db.select({ name: plans.name }).from(plans).where(eq(plans.key, planKey)) : [];
  const [sub] = await db.select({ endsOn: subscriptions.endsOn }).from(subscriptions).where(eq(subscriptions.companyId, selfId));
  const [u] = await db.select({ active: sql<number>`count(*) FILTER (WHERE status = 'ACTIVE')::int`, invited: sql<number>`count(*) FILTER (WHERE status = 'INVITED')::int` })
    .from(users).where(sql`${users.archivedAt} IS NULL`);
  const domains = (await db.select({ d: companyEmailDomains.domain }).from(companyEmailDomains).orderBy(asc(companyEmailDomains.domain))).map((r) => r.d);
  const exceptions = await db.select({ email: companyAllowedEmails.email, reason: companyAllowedEmails.reason, createdAt: companyAllowedEmails.createdAt })
    .from(companyAllowedEmails).orderBy(asc(companyAllowedEmails.email));
  return { company: { ...company, hasLogo: Boolean(logoKey) },
    subscription: { planKey, planName: plan?.name ?? null, status: subscriptionStatus, endsOn: sub?.endsOn ?? null, limits },
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

/*
 * Creator portal registration/login link (Phase 4). The link itself carries a random token; only its keyed
 * hash (auth/tokens.ts hashToken — the same HMAC used for session tokens) is ever stored, in
 * companies.creator_portal_token_hash. The plain token is shown to Company Admin exactly once, at
 * generation time, and is never re-derivable from the database afterwards (see
 * resolve_creator_portal_company in drizzle/0007_creator_portal.sql, which only ever compares hashes).
 */
// The token IS the access control for the link (there is no separate company slug in the URL — a guessable
// company code must not be enough to reach anything). One link per company serves both registration and,
// afterwards, login: /portal/<token>. The plain token exists only in memory between generation and the
// response that carries it back to Company Admin; it is never stored or logged.
export async function getCreatorPortalLink(db: Db, actor: Actor) {
  requirePermission(actor, "company.manage");
  const [c] = await db.select({ enabled: sql<boolean>`(${companies.creatorPortalTokenHash} IS NOT NULL)` }).from(companies).where(eq(companies.id, selfId));
  if (!c) throw notFound("Company");
  return { enabled: c.enabled };
}

/** Generates a new link (or replaces the existing one, immediately invalidating it). The token is returned once. */
export async function rotateCreatorPortalLink(db: Db, actor: Actor, ctx: RequestContext = {}) {
  requirePermission(actor, "company.manage");
  const token = newToken();
  const [c] = await db.update(companies).set({ creatorPortalTokenHash: hashToken(token) }).where(eq(companies.id, selfId)).returning({ id: companies.id });
  if (!c) throw notFound("Company");
  await writeAudit(db, { actorId: actor.userId, action: "company.creator_portal_link_rotated", resourceType: "company", resourceId: actor.companyId ?? undefined }, ctx);
  return { token, portalPath: `/portal/${token}` };
}

/** Immediately stops the existing link from working. New registrations and un-authenticated logins stop; existing creator sessions are unaffected. */
export async function disableCreatorPortalLink(db: Db, actor: Actor, ctx: RequestContext = {}) {
  requirePermission(actor, "company.manage");
  await db.update(companies).set({ creatorPortalTokenHash: null }).where(eq(companies.id, selfId));
  await writeAudit(db, { actorId: actor.userId, action: "company.creator_portal_link_disabled", resourceType: "company", resourceId: actor.companyId ?? undefined }, ctx);
  return { ok: true };
}
