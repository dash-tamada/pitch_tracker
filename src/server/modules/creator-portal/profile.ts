/**
 * Creator-portal profile: the self-service counterpart to staff's "New creator" form (creators/service.ts).
 * A self-registered creator fills this in once — location, languages, experience, bio, agency, previous
 * companies, website, IMDB/Wikipedia/other links (socialLinks — already a generic label+url list, so no
 * new column is needed for this), and "projects worked on" — then keeps it up to date from "My profile" at
 * any time. Two fields on the staff form are deliberately absent here and can never be set through the
 * portal: consentBasis and notes are staff-only (internal record-keeping and legal basis a creator does not
 * self-attest to) — see creators.ts's own GRANT UPDATE list in 0007_creator_portal.sql, which never included
 * consent_basis/notes for pitch_creator; this module does not need to enforce that separately, Postgres does.
 *
 * profileCompletedAt (schema.ts: "'New pitch' stays hidden in the portal until this is set") is set the
 * first time updateMyProfile succeeds, regardless of which optional fields were actually filled in — none
 * of the extra profile fields carry a `*` (required) on the staff form either, only full name and role,
 * both already collected at registration. So "complete" means "saved the profile form once", not "every
 * field non-empty". Once set it is never unset by this module.
 */
import { and, desc, eq, isNull, ne } from "drizzle-orm";
import { z } from "zod";
import { creatorDb, type Db } from "@/server/db/client";
import { creatorProjects, creators, creatorSessions } from "@/server/db/schema";
import { AppError, notFound } from "@/server/lib/errors";
import { normalizeEmail, normalizeMobile, normalizeName } from "@/server/lib/pii";
import { parseInput } from "@/server/lib/validation";
import { CREATOR_TYPES, projectSchema } from "@/server/modules/creators/service";
import { auditPortalAction, pgCode, pgConstraint } from "@/server/modules/creator-portal/auth";
import { getDummyHash, hashPassword, passwordPolicyErrors, verifyPassword } from "@/server/modules/auth/password";
import type { RequestContext } from "@/server/modules/audit/service";

// Mirrors the private httpUrl/optText/creatorFields helpers in creators/service.ts (not exported there, so
// redeclared here) — same limits, so a value that is valid on the staff form is valid through the portal too.
const httpUrl = z.url({ protocol: /^https?$/ }).max(500);
const optText = (max: number) => z.string().trim().max(max).optional().transform((v) => (v === "" ? undefined : v));

export const updateProfileSchema = z.object({
  creatorType: z.enum(CREATOR_TYPES),
  fullName: z.string().trim().min(2).max(120),
  mobile: optText(20),
  // Unlike the staff form, email can never be cleared here: creators_portal_identity_ck requires a
  // self-registered creator to always have an email (it is their login identifier).
  email: z.email().max(254),
  location: optText(120),
  languageKeys: z.array(z.string().trim().min(1).max(60)).max(20),
  yearsExperience: z.number().int().min(0).max(80).optional(),
  bio: optText(5000),
  agency: optText(160),
  previousCompanies: z.array(z.string().trim().min(1).max(160)).max(30),
  website: httpUrl.optional().or(z.literal("").transform(() => undefined)),
  // Generic label+url pairs — e.g. {label: "IMDB", url: "https://www.imdb.com/name/..."} or
  // {label: "Wikipedia", url: "..."}. Nothing IMDB/Wikipedia-specific is validated or fetched server-side,
  // exactly like the staff-side field this reuses (schema.ts: "stored & displayed only").
  socialLinks: z.array(z.object({ label: z.string().trim().max(40), url: httpUrl }).strict()).max(10),
}).partial().strict();

const myProjectUpdateSchema = projectSchema.extend({
  externalLinks: z.array(z.object({ label: z.string().trim().max(40), url: httpUrl }).strict()).max(10),
}).partial().extend({ archived: z.boolean().optional() }).strict();

type CreatorRow = typeof creators.$inferSelect;
type ProjectRow = typeof creatorProjects.$inferSelect;
type ExternalLink = { label: string; url: string };
// jsonb columns come back as `unknown` from drizzle without an explicit $type<>() on the column — the actual
// shape is enforced at write time by updateProfileSchema/projectSchema's z.object({label, url}) validators.
const asLinks = (v: unknown) => v as ExternalLink[];

/** The creator's own full profile — never masked, unlike staff's toCreatorDto (this IS the subject viewing themselves). */
export function toPortalProfileDto(c: CreatorRow) {
  return {
    id: c.id, creatorType: c.creatorType, fullName: c.fullName, mobile: c.mobileE164, email: c.emailNormalized,
    location: c.location, languageKeys: c.languageKeys, yearsExperience: c.yearsExperience, bio: c.bio,
    agency: c.agency, previousCompanies: c.previousCompanies, website: c.website, socialLinks: asLinks(c.socialLinks),
    hasProfileImage: Boolean(c.profileImageKey), profileCompleted: Boolean(c.profileCompletedAt),
    createdAt: c.createdAt, updatedAt: c.updatedAt,
  };
}

function toPortalProjectDto(p: ProjectRow) {
  return {
    id: p.id, projectName: p.projectName, role: p.role, productionCompany: p.productionCompany,
    platformName: p.platformName, releaseYear: p.releaseYear, languageKey: p.languageKey, genreKey: p.genreKey,
    projectStatus: p.projectStatus, description: p.description, externalLinks: asLinks(p.externalLinks),
    addedByMe: Boolean(p.createdByCreatorId), createdAt: p.createdAt, updatedAt: p.updatedAt,
  };
}

async function loadOwnCreator(db: Db, creatorId: string): Promise<CreatorRow> {
  const [c] = await db.select().from(creators).where(eq(creators.id, creatorId));
  // creator_self_select RLS already limits this to the caller's own row — a stranger's id and a made-up
  // one both simply return nothing, so this NOT_FOUND carries no information either way.
  if (!c) throw notFound("Profile");
  return c;
}

export async function getMyProfile(companyId: string, creatorId: string) {
  const db = creatorDb(companyId, creatorId);
  const [c, projects] = await Promise.all([
    loadOwnCreator(db, creatorId),
    db.select().from(creatorProjects).where(and(eq(creatorProjects.creatorId, creatorId), isNull(creatorProjects.archivedAt)))
      .orderBy(desc(creatorProjects.releaseYear), desc(creatorProjects.createdAt)),
  ]);
  return { profile: toPortalProfileDto(c), projects: projects.map(toPortalProjectDto) };
}

export async function updateMyProfile(companyId: string, creatorId: string, raw: unknown, ctx: RequestContext = {}, now = new Date()) {
  const input = parseInput(updateProfileSchema, raw);
  const db = creatorDb(companyId, creatorId);
  return db.transaction(async (tx) => {
    const before = await loadOwnCreator(tx, creatorId);
    const patch: Partial<typeof creators.$inferInsert> = {};
    if (input.mobile !== undefined) {
      const mobileE164 = input.mobile ? normalizeMobile(input.mobile) : null;
      if (input.mobile && !mobileE164) throw new AppError("VALIDATION", "Mobile number is not valid.", { mobile: "Invalid" });
      patch.mobileE164 = mobileE164;
    }
    if (input.email !== undefined) patch.emailNormalized = normalizeEmail(input.email);
    if (input.fullName !== undefined) { patch.fullName = input.fullName; patch.nameNormalized = normalizeName(input.fullName); }
    if (input.creatorType !== undefined) patch.creatorType = input.creatorType;
    const simple = ["location", "languageKeys", "yearsExperience", "bio", "agency", "previousCompanies", "website", "socialLinks"] as const;
    for (const k of simple) if (input[k] !== undefined) (patch as Record<string, unknown>)[k] = input[k];
    const firstCompletion = !before.profileCompletedAt;
    if (firstCompletion) patch.profileCompletedAt = now;

    if (Object.keys(patch).length === 0) return { profileCompleted: Boolean(before.profileCompletedAt) };
    try {
      await tx.update(creators).set(patch).where(eq(creators.id, creatorId));
    } catch (e) {
      // Same two unique indexes registration can hit (creators_company_mobile_uq / creators_company_email_uq) —
      // pgCode/pgConstraint (creator-portal/auth.ts) decide which field actually conflicted, never a guess.
      if (pgCode(e) === "23505") {
        if (pgConstraint(e) === "creators_company_mobile_uq") {
          throw new AppError("CONFLICT", "This mobile number is already registered to another account.", { mobile: "Already registered" });
        }
        throw new AppError("CONFLICT", "An account with this email already exists.", { email: "Already registered" });
      }
      throw e;
    }
    await auditPortalAction(tx, firstCompletion ? "creator_portal.profile_completed" : "creator_portal.profile_updated", "creator", creatorId, { fields: Object.keys(patch) });
    return { profileCompleted: true };
  });
}

export async function listMyProjects(companyId: string, creatorId: string) {
  const db = creatorDb(companyId, creatorId);
  const rows = await db.select().from(creatorProjects)
    .where(and(eq(creatorProjects.creatorId, creatorId), isNull(creatorProjects.archivedAt)))
    .orderBy(desc(creatorProjects.releaseYear), desc(creatorProjects.createdAt));
  return rows.map(toPortalProjectDto);
}

export async function addMyProject(companyId: string, creatorId: string, raw: unknown, ctx: RequestContext = {}) {
  const p = parseInput(projectSchema, raw);
  const db = creatorDb(companyId, creatorId);
  // creator_add_project's WITH CHECK requires creator_id = created_by_creator_id = app_creator_id() — a
  // project can only ever be added to the caller's own profile, by the caller, never chosen otherwise.
  const [row] = await db.insert(creatorProjects).values({
    creatorId, createdByCreatorId: creatorId, projectName: p.projectName, role: p.role,
    productionCompany: p.productionCompany ?? null, platformName: p.platformName ?? null, releaseYear: p.releaseYear ?? null,
    languageKey: p.languageKey ?? null, genreKey: p.genreKey ?? null, projectStatus: p.projectStatus ?? null,
    description: p.description ?? null, externalLinks: p.externalLinks,
  }).returning({ id: creatorProjects.id });
  await auditPortalAction(db, "creator_portal.project_added", "creator", creatorId, { projectId: row!.id, projectName: p.projectName });
  return row!;
}

export async function updateMyProject(companyId: string, creatorId: string, projectId: string, raw: unknown, ctx: RequestContext = {}) {
  const p = parseInput(myProjectUpdateSchema, raw);
  const db = creatorDb(companyId, creatorId);
  const [existing] = await db.select().from(creatorProjects).where(eq(creatorProjects.id, projectId));
  // creator_own_projects RLS already means a project on someone else's profile (or a made-up id) simply
  // never appears here — this NOT_FOUND is what both look like, so there is no existence oracle.
  if (!existing) throw notFound("Project");
  const { archived, ...fields } = p;
  const patch: Record<string, unknown> = { ...fields };
  if (archived !== undefined) patch.archivedAt = archived ? new Date() : null;
  if (Object.keys(patch).length === 0) return { id: projectId };
  await db.update(creatorProjects).set(patch).where(eq(creatorProjects.id, projectId));
  await auditPortalAction(db, "creator_portal.project_edited", "creator", creatorId, { projectId, ...fields, archived });
  return { id: projectId };
}

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(128),
  newPassword: z.string().min(1).max(128),
}).strict();

/**
 * Mirrors auth/service.ts's changeOwnPassword, minus the TOTP/MFA step: creators have no MFA anywhere in
 * this system, so there is nothing to re-verify beyond the current password. Revokes every OTHER session
 * (sessionId is the caller's own, currently-authenticated session — never revoked out from under itself).
 */
export async function changeMyPassword(companyId: string, creatorId: string, sessionId: string, raw: unknown, ctx: RequestContext = {}, now = new Date()): Promise<{ ok: true }> {
  const { currentPassword, newPassword } = parseInput(changePasswordSchema, raw);
  const db = creatorDb(companyId, creatorId);
  return db.transaction(async (tx) => {
    const [c] = await tx.select({ id: creators.id, emailNormalized: creators.emailNormalized, passwordHash: creators.passwordHash })
      .from(creators).where(eq(creators.id, creatorId));
    if (!c || !c.passwordHash) {
      await verifyPassword(await getDummyHash(), currentPassword); // equalise timing with the "wrong current password" path
      throw new AppError("UNAUTHENTICATED", "Please sign in.");
    }
    const currentOk = await verifyPassword(c.passwordHash, currentPassword);
    if (!currentOk) throw new AppError("INVALID_CREDENTIALS", "Current password is incorrect.", { currentPassword: "Incorrect" });

    const errors = passwordPolicyErrors(newPassword, { email: c.emailNormalized ?? undefined });
    if (errors.length) throw new AppError("VALIDATION", errors.join(" "), { newPassword: errors[0]! });
    if (await verifyPassword(c.passwordHash, newPassword)) {
      throw new AppError("VALIDATION", "New password must be different from your current password.", { newPassword: "Reuse" });
    }

    await tx.update(creators).set({ passwordHash: await hashPassword(newPassword), passwordChangedAt: now }).where(eq(creators.id, creatorId));
    await tx.update(creatorSessions).set({ revokedAt: now })
      .where(and(eq(creatorSessions.creatorId, creatorId), isNull(creatorSessions.revokedAt), ne(creatorSessions.id, sessionId)));
    await auditPortalAction(tx, "creator_portal.password_changed", "creator", creatorId);
    return { ok: true };
  });
}
