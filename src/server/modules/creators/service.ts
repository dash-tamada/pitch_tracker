/**
 * Creator management: dedupe, create (with first-time onboarding projects), profile, edit, archive,
 * projects, statistics computed from real workflow records. PII is masked server-side.
 */
import { and, count, desc, eq, ilike, isNotNull, isNull, lt, or, sql } from "drizzle-orm";
import { z } from "zod";
import type { Db, DbOrTx } from "@/server/db/client";
import { creatorProjects, creators, pitches, platformPitches, platformResponses, workflowEvents } from "@/server/db/schema";
import { AppError, notFound } from "@/server/lib/errors";
import { maskEmail, maskMobile, normalizeEmail, normalizeMobile, normalizeName } from "@/server/lib/pii";
import { decodeCursor, encodeCursor, PAGE_MAX, parseInput, type Page } from "@/server/lib/validation";
import { can, pitchVisibilityCondition, requirePermission, type Actor } from "@/server/modules/authz/policy";
import { writeAudit, type RequestContext } from "@/server/modules/audit/service";

const httpUrl = z.url({ protocol: /^https?$/ }).max(500);
export const CREATOR_TYPES = ["WRITER", "DIRECTOR", "WRITER_DIRECTOR", "PRODUCER", "CREATOR", "OTHER"] as const;
const optText = (max: number) => z.string().trim().max(max).optional().transform((v) => (v === "" ? undefined : v));

export const projectSchema = z.object({
  projectName: z.string().trim().min(1).max(200),
  role: z.enum(CREATOR_TYPES),
  productionCompany: optText(160),
  platformName: optText(120),
  releaseYear: z.number().int().min(1900).max(2100).optional(),
  languageKey: optText(60),
  genreKey: optText(60),
  projectStatus: optText(60),
  description: optText(5000),
  externalLinks: z.array(z.object({ label: z.string().trim().max(40), url: httpUrl }).strict()).max(10).default([]),
}).strict();

const projectUpdateSchema = projectSchema.extend({
  externalLinks: z.array(z.object({ label: z.string().trim().max(40), url: httpUrl }).strict()).max(10),
}).partial().extend({ archived: z.boolean().optional() }).strict();

const creatorFields = {
  creatorType: z.enum(CREATOR_TYPES),
  fullName: z.string().trim().min(2).max(120),
  mobile: optText(20),
  email: z.email().max(254).optional().or(z.literal("").transform(() => undefined)),
  location: optText(120),
  languageKeys: z.array(z.string().trim().min(1).max(60)).max(20),
  yearsExperience: z.number().int().min(0).max(80).optional(),
  bio: optText(5000),
  agency: optText(160),
  previousCompanies: z.array(z.string().trim().min(1).max(160)).max(30),
  website: httpUrl.optional().or(z.literal("").transform(() => undefined)),
  socialLinks: z.array(z.object({ label: z.string().trim().max(40), url: httpUrl }).strict()).max(10),
  notes: optText(5000),
  consentBasis: optText(60),
};

export const createCreatorSchema = z.object({
  ...creatorFields,
  languageKeys: creatorFields.languageKeys.default([]),
  previousCompanies: creatorFields.previousCompanies.default([]),
  socialLinks: creatorFields.socialLinks.default([]),
  projects: z.array(projectSchema).max(50).default([]),
}).strict();
// No defaults here: an omitted field must stay unchanged, never be reset to [].
export const updateCreatorSchema = z.object(creatorFields).partial().strict();

type CreatorRow = typeof creators.$inferSelect;

/** What any viewer may see; PII only with creator.view_pii. Internal notes need creator.edit. */
export function toCreatorDto(actor: Actor, c: CreatorRow) {
  const pii = can(actor, "creator.view_pii");
  return {
    id: c.id, creatorType: c.creatorType, fullName: c.fullName,
    mobile: pii ? c.mobileE164 : maskMobile(c.mobileE164),
    email: pii ? c.emailNormalized : maskEmail(c.emailNormalized),
    piiMasked: !pii,
    location: c.location, languageKeys: c.languageKeys, yearsExperience: c.yearsExperience, bio: c.bio,
    agency: c.agency, previousCompanies: c.previousCompanies, website: c.website, socialLinks: c.socialLinks,
    hasProfileImage: Boolean(c.profileImageKey),
    notes: can(actor, "creator.edit") ? c.notes : null,
    consentBasis: c.consentBasis, archived: Boolean(c.archivedAt), createdAt: c.createdAt, updatedAt: c.updatedAt,
  };
}

async function loadCreator(db: DbOrTx, id: string, includeArchived = false): Promise<CreatorRow> {
  const [c] = await db.select().from(creators).where(includeArchived ? eq(creators.id, id) : and(eq(creators.id, id), isNull(creators.archivedAt)));
  if (!c) throw notFound("Creator");
  return c;
}

function normalizeContact(input: { mobile?: string | undefined; email?: string | undefined }) {
  const mobileE164 = input.mobile ? normalizeMobile(input.mobile) : null;
  if (input.mobile && !mobileE164) throw new AppError("VALIDATION", "Mobile number is not valid.", { mobile: "Invalid" });
  return { mobileE164, emailNormalized: input.email ? normalizeEmail(input.email) : null };
}

async function assertNoDuplicate(db: DbOrTx, mobileE164: string | null, emailNormalized: string | null, exceptId?: string) {
  const conds = [
    ...(mobileE164 ? [eq(creators.mobileE164, mobileE164)] : []),
    ...(emailNormalized ? [eq(creators.emailNormalized, emailNormalized)] : []),
  ];
  if (!conds.length) return;
  const rows = await db.select({ id: creators.id }).from(creators).where(or(...conds)).limit(2);
  if (rows.some((r) => r.id !== exceptId)) {
    throw new AppError("CONFLICT", "A creator with this mobile number or email already exists. Use the existing profile.");
  }
}

/** Duplicate check before creating: exact mobile/email match, fuzzy name match. */
export async function findCreatorMatches(db: Db, actor: Actor, q: { name?: string; mobile?: string; email?: string }) {
  requirePermission(actor, "creator.view");
  const conds = [];
  const mobile = q.mobile ? normalizeMobile(q.mobile) : null;
  if (mobile) conds.push(eq(creators.mobileE164, mobile));
  if (q.email && q.email.includes("@")) conds.push(eq(creators.emailNormalized, normalizeEmail(q.email)));
  if (q.name && q.name.trim().length >= 3) {
    const n = normalizeName(q.name);
    conds.push(or(sql`${creators.nameNormalized} % ${n}`, ilike(creators.nameNormalized, `%${escapeLike(n)}%`))!);
  }
  if (conds.length === 0) return [];
  const n = q.name ? normalizeName(q.name) : "";
  const exact = sql`CASE WHEN ${mobile ? sql`${creators.mobileE164} = ${mobile}` : sql`false`} OR ${q.email?.includes("@") ? sql`${creators.emailNormalized} = ${normalizeEmail(q.email)}` : sql`false`} THEN 0 ELSE 1 END`;
  const rows = await db.select().from(creators).where(and(isNull(creators.archivedAt), or(...conds)))
    .orderBy(exact, desc(sql`similarity(${creators.nameNormalized}, ${n})`), creators.fullName).limit(10);
  const emailN = q.email && q.email.includes("@") ? normalizeEmail(q.email) : null;
  return rows.map((r) => {
    const d = toCreatorDto(actor, r);
    const matchedOn: string[] = [];
    if (mobile && r.mobileE164 === mobile) matchedOn.push("mobile");
    if (emailN && r.emailNormalized === emailN) matchedOn.push("email");
    if (matchedOn.length === 0) matchedOn.push("name");
    return { id: d.id, fullName: d.fullName, creatorType: d.creatorType, mobile: d.mobile, email: d.email, location: d.location, matchedOn };
  });
}

export function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (m) => `\\${m}`);
}

export async function createCreator(db: Db, actor: Actor, raw: unknown, ctx: RequestContext = {}) {
  requirePermission(actor, "creator.create");
  const input = parseInput(createCreatorSchema, raw);
  const { mobileE164, emailNormalized } = normalizeContact(input);

  return db.transaction(async (tx) => {
    await assertNoDuplicate(tx, mobileE164, emailNormalized);
    const [row] = await tx.insert(creators).values({
      creatorType: input.creatorType, fullName: input.fullName, nameNormalized: normalizeName(input.fullName),
      mobileE164, emailNormalized, location: input.location ?? null, languageKeys: input.languageKeys,
      yearsExperience: input.yearsExperience ?? null, bio: input.bio ?? null, agency: input.agency ?? null,
      previousCompanies: input.previousCompanies, website: input.website ?? null, socialLinks: input.socialLinks,
      notes: input.notes ?? null, consentBasis: input.consentBasis ?? null,
      consentRecordedAt: input.consentBasis ? new Date() : null, createdById: actor.userId,
    }).returning({ id: creators.id });
    if (input.projects.length) {
      await tx.insert(creatorProjects).values(input.projects.map((p) => projectValues(p, row!.id, actor.userId)));
    }
    await writeAudit(tx, { actorId: actor.userId, action: "creator.created", resourceType: "creator", resourceId: row!.id,
      after: { fullName: input.fullName, creatorType: input.creatorType, projects: input.projects.length } }, ctx);
    return row!;
  });
}

function projectValues(p: z.infer<typeof projectSchema>, creatorId: string, userId: string) {
  return {
    creatorId, createdById: userId, projectName: p.projectName, role: p.role,
    productionCompany: p.productionCompany ?? null, platformName: p.platformName ?? null, releaseYear: p.releaseYear ?? null,
    languageKey: p.languageKey ?? null, genreKey: p.genreKey ?? null, projectStatus: p.projectStatus ?? null,
    description: p.description ?? null, externalLinks: p.externalLinks,
  };
}

export async function updateCreator(db: Db, actor: Actor, id: string, raw: unknown, ctx: RequestContext = {}) {
  requirePermission(actor, "creator.edit");
  const input = parseInput(updateCreatorSchema, raw);
  return db.transaction(async (tx) => {
    const before = await loadCreator(tx, id);
    const patch: Partial<typeof creators.$inferInsert> = {};
    if (input.mobile !== undefined || input.email !== undefined) {
      const c = normalizeContact({ mobile: input.mobile, email: input.email });
      if (input.mobile !== undefined) patch.mobileE164 = c.mobileE164;
      if (input.email !== undefined) patch.emailNormalized = c.emailNormalized;
      await assertNoDuplicate(tx, patch.mobileE164 ?? null, patch.emailNormalized ?? null, id);
    }
    if (input.fullName !== undefined) { patch.fullName = input.fullName; patch.nameNormalized = normalizeName(input.fullName); }
    const simple = ["creatorType", "location", "languageKeys", "yearsExperience", "bio", "agency", "previousCompanies", "website", "socialLinks", "notes"] as const;
    for (const k of simple) if (input[k] !== undefined) (patch as Record<string, unknown>)[k] = input[k];
    if (input.consentBasis !== undefined) { patch.consentBasis = input.consentBasis; patch.consentRecordedAt = new Date(); }
    if (Object.keys(patch).length === 0) return { id };
    await tx.update(creators).set(patch).where(eq(creators.id, id));
    const changed = Object.keys(patch);
    await writeAudit(tx, { actorId: actor.userId, action: "creator.edited", resourceType: "creator", resourceId: id,
      before: Object.fromEntries(changed.map((k) => [k, (before as Record<string, unknown>)[k]])),
      after: Object.fromEntries(changed.map((k) => [k, (patch as Record<string, unknown>)[k]])) }, ctx);
    return { id };
  });
}

export async function setCreatorArchived(db: Db, actor: Actor, id: string, archived: boolean, ctx: RequestContext = {}) {
  requirePermission(actor, "creator.archive");
  return db.transaction(async (tx) => {
    const c = await loadCreator(tx, id, true);
    if (Boolean(c.archivedAt) === archived) return { id };
    await tx.update(creators).set({ archivedAt: archived ? new Date() : null }).where(eq(creators.id, id));
    await writeAudit(tx, { actorId: actor.userId, action: archived ? "creator.archived" : "creator.restored", resourceType: "creator", resourceId: id }, ctx);
    return { id };
  });
}

export const listCreatorsSchema = z.object({
  q: z.string().trim().max(120).optional(),
  type: z.enum(CREATOR_TYPES).optional(),
  archived: z.enum(["true", "false"]).optional(),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(PAGE_MAX).default(25),
}).strict();

export async function listCreators(db: Db, actor: Actor, raw: unknown): Promise<Page<ReturnType<typeof toCreatorDto>>> {
  requirePermission(actor, "creator.view");
  const f = parseInput(listCreatorsSchema, raw);
  const cursor = decodeCursor(f.cursor);
  const conds = [f.archived === "true" && can(actor, "creator.archive") ? isNotNull(creators.archivedAt) : isNull(creators.archivedAt)];
  if (f.type) conds.push(eq(creators.creatorType, f.type));
  if (f.q) {
    const q = f.q;
    const mobile = /\d{6,}/.test(q.replace(/\D/g, "")) ? normalizeMobile(q) : null;
    const byContact = can(actor, "creator.view_pii")
      ? [...(mobile ? [eq(creators.mobileE164, mobile)] : []), ...(q.includes("@") ? [eq(creators.emailNormalized, normalizeEmail(q))] : [])]
      // Without PII permission, exact contact lookup is still allowed (it confirms nothing beyond what the searcher typed).
      : [...(mobile ? [eq(creators.mobileE164, mobile)] : [])];
    conds.push(or(ilike(creators.nameNormalized, `%${escapeLike(normalizeName(q))}%`), ...byContact)!);
  }
  if (cursor) {
    conds.push(or(lt(creators.createdAt, cursor.createdAt), and(eq(creators.createdAt, cursor.createdAt), lt(creators.id, cursor.id)))!);
  }
  const rows = await db.select().from(creators).where(and(...conds)).orderBy(desc(creators.createdAt), desc(creators.id)).limit(f.limit + 1);
  const page = rows.slice(0, f.limit);
  const last = page.at(-1);
  return { items: page.map((r) => toCreatorDto(actor, r)), nextCursor: rows.length > f.limit && last ? encodeCursor(last.createdAt, last.id) : null };
}

/** Statistics are computed from workflow history; only pitches the viewer may see are counted. */
export async function creatorStats(db: DbOrTx, actor: Actor, creatorId: string) {
  const visible = and(eq(pitches.creatorId, creatorId), pitchVisibilityCondition(actor));
  // Drizzle renders columns unqualified inside select-list SQL, which would bind to the subquery's own "id".
  // Qualify explicitly so the EXISTS correlates with the outer pitch row.
  const outerId = sql.raw('"pitches"."id"');
  const reached = (stages: string[]) => sql<number>`count(DISTINCT ${pitches.id}) FILTER (WHERE EXISTS (
      SELECT 1 FROM workflow_events we WHERE we.pitch_id = ${outerId} AND we.to_stage_key IN (${sql.join(stages.map((s) => sql`${s}`), sql`, `)})))::int`;
  const did = (actions: string[]) => sql<number>`count(DISTINCT ${pitches.id}) FILTER (WHERE EXISTS (
      SELECT 1 FROM workflow_events we WHERE we.pitch_id = ${outerId} AND we.action::text IN (${sql.join(actions.map((s) => sql`${s}`), sql`, `)})))::int`;
  const now = (stages: string[]) => sql<number>`count(*) FILTER (WHERE ${pitches.currentStageKey} IN (${sql.join(stages.map((s) => sql`${s}`), sql`, `)}))::int`;

  const [s] = await db.select({
    total: sql<number>`count(*)::int`,
    underReview: now(["SUBMITTED", "INITIAL_REVIEW", "INTERNAL_REVIEW", "SENIOR_REVIEW", "CHANGES_REQUESTED", "ON_HOLD"]),
    rejected: now(["REJECTED"]),
    forwarded: did(["FORWARD", "ACCEPT"]),
    accepted: did(["ACCEPT"]),
    approved: reached(["APPROVED_FOR_PLATFORM"]),
    sentToPlatforms: did(["RECORD_PLATFORM_PITCH"]),
    platformApproved: did(["MARK_PLATFORM_APPROVED"]),
    development: reached(["DEVELOPMENT"]),
    greenlit: reached(["GREENLIT"]),
    production: reached(["PRODUCTION"]),
    completed: reached(["COMPLETED", "RELEASED"]),
  }).from(pitches).where(visible);

  const [pr] = await db.select({ n: sql<number>`count(DISTINCT ${platformPitches.pitchId})::int` })
    .from(platformResponses)
    .innerJoin(platformPitches, eq(platformPitches.id, platformResponses.platformPitchId))
    .innerJoin(pitches, eq(pitches.id, platformPitches.pitchId))
    .where(and(visible, eq(platformResponses.status, "REJECTED")));

  const stats = { ...s!, platformRejected: pr?.n ?? 0 };
  const rate = (n: number, d: number) => (d === 0 ? null : Math.round((n / d) * 1000) / 10);
  return {
    ...stats,
    // Definitions shown in the UI so the numbers can be checked:
    rates: {
      approvalRate: rate(stats.approved, stats.total),                       // % of pitches CEO/COO approved
      platformApprovalRate: rate(stats.platformApproved, stats.sentToPlatforms), // % of platform-pitched stories approved
      productionRate: rate(stats.production, stats.total),
    },
  };
}

export async function getCreatorProfile(db: Db, actor: Actor, id: string) {
  requirePermission(actor, "creator.view");
  const c = await loadCreator(db, id, can(actor, "creator.archive"));
  const [projects, stats] = await Promise.all([
    db.select().from(creatorProjects).where(and(eq(creatorProjects.creatorId, id), isNull(creatorProjects.archivedAt)))
      .orderBy(desc(creatorProjects.releaseYear), desc(creatorProjects.createdAt)),
    creatorStats(db, actor, id),
  ]);
  return { creator: toCreatorDto(actor, c), projects, stats };
}

export async function creatorPitches(db: Db, actor: Actor, id: string) {
  requirePermission(actor, "creator.view");
  await loadCreator(db, id, true);
  return db.select({ id: pitches.id, pitchCode: pitches.pitchCode, title: pitches.title, formatKey: pitches.formatKey,
    languageKey: pitches.languageKey, genreKey: pitches.genreKey, currentStageKey: pitches.currentStageKey,
    stageEnteredAt: pitches.stageEnteredAt, createdAt: pitches.createdAt })
    .from(pitches).where(and(eq(pitches.creatorId, id), pitchVisibilityCondition(actor))).orderBy(desc(pitches.createdAt)).limit(200);
}

export async function creatorPlatformHistory(db: Db, actor: Actor, id: string) {
  requirePermission(actor, "creator.view");
  return db.select({ pitchId: pitches.id, title: pitches.title, platformPitchId: platformPitches.id, platformId: platformPitches.platformId,
    pitchDate: platformPitches.pitchDate, status: platformPitches.currentStatus })
    .from(platformPitches).innerJoin(pitches, eq(pitches.id, platformPitches.pitchId))
    .where(and(eq(pitches.creatorId, id), pitchVisibilityCondition(actor))).orderBy(desc(platformPitches.pitchDate)).limit(200);
}

export async function creatorActivity(db: Db, actor: Actor, id: string) {
  requirePermission(actor, "creator.view");
  return db.select({ pitchId: pitches.id, title: pitches.title, action: workflowEvents.action, toStageKey: workflowEvents.toStageKey,
    actorId: workflowEvents.actorId, actorCreatorId: workflowEvents.actorCreatorId, createdAt: workflowEvents.createdAt })
    .from(workflowEvents).innerJoin(pitches, eq(pitches.id, workflowEvents.pitchId))
    .where(and(eq(pitches.creatorId, id), pitchVisibilityCondition(actor))).orderBy(desc(workflowEvents.createdAt)).limit(100);
}

export async function addCreatorProject(db: Db, actor: Actor, creatorId: string, raw: unknown, ctx: RequestContext = {}) {
  requirePermission(actor, "creator.edit");
  const p = parseInput(projectSchema, raw);
  return db.transaction(async (tx) => {
    await loadCreator(tx, creatorId);
    const [row] = await tx.insert(creatorProjects).values(projectValues(p, creatorId, actor.userId)).returning({ id: creatorProjects.id });
    await writeAudit(tx, { actorId: actor.userId, action: "creator.project_added", resourceType: "creator", resourceId: creatorId, after: { projectId: row!.id, projectName: p.projectName } }, ctx);
    return row!;
  });
}

export async function updateCreatorProject(db: Db, actor: Actor, projectId: string, raw: unknown, ctx: RequestContext = {}) {
  requirePermission(actor, "creator.edit");
  const p = parseInput(projectUpdateSchema, raw);
  return db.transaction(async (tx) => {
    const [existing] = await tx.select().from(creatorProjects).where(eq(creatorProjects.id, projectId));
    if (!existing) throw notFound("Project");
    const { archived, ...fields } = p;
    const patch: Record<string, unknown> = { ...fields };
    if (archived !== undefined) patch.archivedAt = archived ? new Date() : null;
    await tx.update(creatorProjects).set(patch).where(eq(creatorProjects.id, projectId));
    await writeAudit(tx, { actorId: actor.userId, action: "creator.project_edited", resourceType: "creator", resourceId: existing.creatorId,
      before: { projectId, projectName: existing.projectName }, after: { projectId, ...fields, archived } }, ctx);
    return { id: projectId };
  });
}

export async function countCreators(db: Db) {
  const [r] = await db.select({ n: count() }).from(creators).where(isNull(creators.archivedAt));
  return r?.n ?? 0;
}

