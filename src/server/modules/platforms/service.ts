/**
 * OTT / platform database, contacts, platform pitches, append-only responses and follow-ups.
 * Pitching and platform approval go through the workflow engine in the same transaction, so a platform record
 * can never exist for a pitch that CEO/COO has not approved, and approval always names the platform.
 */
import { and, asc, desc, eq, inArray, isNull, lte, max, sql } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/server/db/client";
import {
  documents, documentVersions, followUps, lookupValues, pitchParticipants, pitches, platformContacts, platformPitches, platformResponses, platforms, users,
} from "@/server/db/schema";
import { AppError, notFound } from "@/server/lib/errors";
import { maskEmail, maskMobile, normalizeEmail, normalizeMobile } from "@/server/lib/pii";
import { parseInput } from "@/server/lib/validation";
import { can, pitchVisibilityCondition, requirePermission, type Actor } from "@/server/modules/authz/policy";
import { writeAudit, type RequestContext } from "@/server/modules/audit/service";
import { loadVisiblePitch, performAction } from "@/server/modules/workflow/engine";
import { notify } from "@/server/modules/notifications/service";
import { PLATFORM_STATUS_TEXT } from "@/server/modules/platforms/labels";

const PLATFORM_STATUSES = ["NOT_YET_PITCHED", "PITCHED", "AWAITING_RESPONSE", "INTERESTED", "MEETING_REQUESTED", "REQUESTED_CHANGES",
  "SECOND_DRAFT_REQUESTED", "APPROVED", "REJECTED", "ON_HOLD", "DEVELOPMENT_DISCUSSION", "READY_FOR_DEVELOPMENT", "GREENLIT"] as const;
const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");
const opt = (max: number) => z.string().trim().max(max).optional().transform((v) => (v === "" ? undefined : v));

/* ───────────── Platforms & contacts (Admin) ───────────── */

const platformFields = {
  name: z.string().trim().min(1).max(120),
  kind: z.enum(["OTT", "BROADCAST", "AVOD", "OTHER"]),
  languageKeys: z.array(z.string().max(60)).max(20),
  genreKeys: z.array(z.string().max(60)).max(30),
  preferences: opt(5000),
  notes: opt(5000),
  active: z.boolean(),
};
export const createPlatformSchema = z.object({ ...platformFields, kind: platformFields.kind.default("OTT"), languageKeys: platformFields.languageKeys.default([]),
  genreKeys: platformFields.genreKeys.default([]), active: platformFields.active.default(true) }).strict();
export const updatePlatformSchema = z.object(platformFields).partial().strict();

export async function listPlatforms(db: Db, actor: Actor, includeInactive = false) {
  requirePermission(actor, "platform.view");
  const rows = await db.select().from(platforms).where(includeInactive && can(actor, "platform.manage") ? undefined : eq(platforms.active, true)).orderBy(asc(platforms.name));
  const stats = await db.select({ platformId: platformPitches.platformId, total: sql<number>`count(*)::int`,
    approved: sql<number>`count(*) FILTER (WHERE ${platformPitches.currentStatus} IN ('APPROVED','READY_FOR_DEVELOPMENT','GREENLIT'))::int`,
    rejected: sql<number>`count(*) FILTER (WHERE ${platformPitches.currentStatus} = 'REJECTED')::int`,
    open: sql<number>`count(*) FILTER (WHERE ${platformPitches.currentStatus} NOT IN ('APPROVED','READY_FOR_DEVELOPMENT','GREENLIT','REJECTED'))::int` })
    .from(platformPitches).innerJoin(pitches, eq(pitches.id, platformPitches.pitchId)).where(pitchVisibilityCondition(actor))
    .groupBy(platformPitches.platformId);
  return rows.map((p) => ({ ...p, stats: stats.find((s) => s.platformId === p.id) ?? { total: 0, approved: 0, rejected: 0, open: 0 } }));
}

async function assertLookupKeys(db: Db, type: "LANGUAGE" | "GENRE" | "PITCH_METHOD", keys: string[], field: string) {
  const unique = [...new Set(keys)];
  if (!unique.length) return;
  const found = await db.select({ key: lookupValues.key }).from(lookupValues).where(and(eq(lookupValues.type, type), inArray(lookupValues.key, unique)));
  if (found.length !== unique.length) throw new AppError("VALIDATION", "Unknown option selected.", { [field]: "Invalid" });
}

export async function createPlatform(db: Db, actor: Actor, raw: unknown, ctx: RequestContext = {}) {
  requirePermission(actor, "platform.manage");
  const input = parseInput(createPlatformSchema, raw);
  await assertLookupKeys(db, "LANGUAGE", input.languageKeys, "languageKeys");
  await assertLookupKeys(db, "GENRE", input.genreKeys, "genreKeys");
  try {
    return await db.transaction(async (tx) => {
      const [p] = await tx.insert(platforms).values({ ...input, preferences: input.preferences ?? null, notes: input.notes ?? null }).returning({ id: platforms.id });
      await writeAudit(tx, { actorId: actor.userId, action: "platform.added", resourceType: "platform", resourceId: p!.id, after: { name: input.name } }, ctx);
      return p!;
    });
  } catch (e) {
    if ((e as { cause?: { code?: string } }).cause?.code === "23505") throw new AppError("CONFLICT", "A platform with this name already exists.");
    throw e;
  }
}

export async function updatePlatform(db: Db, actor: Actor, id: string, raw: unknown, ctx: RequestContext = {}) {
  requirePermission(actor, "platform.manage");
  const input = parseInput(updatePlatformSchema, raw);
  if (input.languageKeys) await assertLookupKeys(db, "LANGUAGE", input.languageKeys, "languageKeys");
  if (input.genreKeys) await assertLookupKeys(db, "GENRE", input.genreKeys, "genreKeys");
  return db.transaction(async (tx) => {
    const [before] = await tx.select().from(platforms).where(eq(platforms.id, id));
    if (!before) throw notFound("Platform");
    await tx.update(platforms).set(input).where(eq(platforms.id, id));
    await writeAudit(tx, { actorId: actor.userId, action: input.active === false ? "platform.disabled" : "platform.edited", resourceType: "platform", resourceId: id,
      before: Object.fromEntries(Object.keys(input).map((k) => [k, (before as Record<string, unknown>)[k]])), after: input }, ctx);
    return { id };
  });
}

const contactFields = {
  fullName: z.string().trim().min(1).max(120), designation: opt(120), department: opt(120),
  email: z.email().max(254).optional().or(z.literal("").transform(() => undefined)), mobile: opt(20), notes: opt(2000), active: z.boolean(),
};
export const contactSchema = z.object({ ...contactFields, active: contactFields.active.default(true) }).strict();

function contactValues(input: Partial<z.infer<typeof contactSchema>>) {
  const out: Record<string, unknown> = {};
  for (const k of ["fullName", "designation", "department", "notes", "active"] as const) if (input[k] !== undefined) out[k] = input[k];
  if (input.email !== undefined) out.email = input.email ? normalizeEmail(input.email) : null;
  if (input.mobile !== undefined) {
    const m = input.mobile ? normalizeMobile(input.mobile) : null;
    if (input.mobile && !m) throw new AppError("VALIDATION", "Mobile number is not valid.", { mobile: "Invalid" });
    out.mobileE164 = m;
  }
  return out;
}

export async function addPlatformContact(db: Db, actor: Actor, platformId: string, raw: unknown, ctx: RequestContext = {}) {
  requirePermission(actor, "platform.manage");
  const input = parseInput(contactSchema, raw);
  return db.transaction(async (tx) => {
    const [p] = await tx.select({ id: platforms.id }).from(platforms).where(eq(platforms.id, platformId));
    if (!p) throw notFound("Platform");
    const [c] = await tx.insert(platformContacts).values({ platformId, ...(contactValues(input) as { fullName: string }) }).returning({ id: platformContacts.id });
    await writeAudit(tx, { actorId: actor.userId, action: "platform.contact_added", resourceType: "platform", resourceId: platformId, after: { contactId: c!.id, fullName: input.fullName } }, ctx);
    return c!;
  });
}

export async function updatePlatformContact(db: Db, actor: Actor, contactId: string, raw: unknown, ctx: RequestContext = {}) {
  requirePermission(actor, "platform.manage");
  const input = parseInput(z.object(contactFields).partial().strict(), raw);
  return db.transaction(async (tx) => {
    const [c] = await tx.select().from(platformContacts).where(eq(platformContacts.id, contactId));
    if (!c) throw notFound("Contact");
    await tx.update(platformContacts).set(contactValues(input)).where(eq(platformContacts.id, contactId));
    await writeAudit(tx, { actorId: actor.userId, action: "platform.contact_edited", resourceType: "platform", resourceId: c.platformId, after: { contactId, fields: Object.keys(input) } }, ctx);
    return { id: contactId };
  });
}

/** Contact email/mobile are business-sensitive: full values only for people who pitch or manage platforms. */
export async function getPlatform(db: Db, actor: Actor, id: string) {
  requirePermission(actor, "platform.view");
  const [p] = await db.select().from(platforms).where(eq(platforms.id, id));
  if (!p || (!p.active && !can(actor, "platform.manage"))) throw notFound("Platform");
  const full = can(actor, "platform.manage") || can(actor, "platform.pitch");
  const contacts = (await db.select().from(platformContacts).where(eq(platformContacts.platformId, id)).orderBy(asc(platformContacts.fullName)))
    .filter((c) => c.active || can(actor, "platform.manage"))
    .map((c) => ({ ...c, email: full ? c.email : maskEmail(c.email), mobileE164: full ? c.mobileE164 : maskMobile(c.mobileE164), notes: full ? c.notes : null }));
  const pitchesForPlatform = await db.select({ platformPitchId: platformPitches.id, pitchId: pitches.id, title: pitches.title, pitchDate: platformPitches.pitchDate,
    status: platformPitches.currentStatus, roundNo: platformPitches.roundNo, pitchedBy: users.fullName, nextFollowUpOn: platformPitches.nextFollowUpOn })
    .from(platformPitches).innerJoin(pitches, eq(pitches.id, platformPitches.pitchId)).innerJoin(users, eq(users.id, platformPitches.pitchedById))
    .where(and(eq(platformPitches.platformId, id), pitchVisibilityCondition(actor))).orderBy(desc(platformPitches.pitchDate)).limit(300);
  return { platform: p, contacts, pitches: pitchesForPlatform };
}

/* ───────────── Platform pitches & responses ───────────── */

export const recordPitchSchema = z.object({
  expectedVersion: z.number().int().min(1),
  platformId: z.uuid(),
  contactId: z.uuid().optional(),
  pitchDate: dateStr,
  methodKey: opt(60),
  materialsSent: z.array(z.string().trim().min(1).max(120)).max(20).default([]),
  scriptVersionId: z.uuid().optional(),
  deckVersionId: z.uuid().optional(),
  remarks: opt(5000),
  followUpOn: dateStr.optional(),
}).strict();

async function assertVersionOfPitch(db: Db, versionId: string | undefined, pitchId: string, field: string) {
  if (!versionId) return;
  const [v] = await db.select({ id: documentVersions.id }).from(documentVersions).innerJoin(documents, eq(documents.id, documentVersions.documentId))
    .where(and(eq(documentVersions.id, versionId), eq(documents.pitchId, pitchId)));
  if (!v) throw new AppError("VALIDATION", "That document version does not belong to this pitch.", { [field]: "Invalid" });
}

const todayIst = (now = new Date()) => new Date(now.getTime() + 5.5 * 3600_000).toISOString().slice(0, 10);

export async function recordPlatformPitch(db: Db, actor: Actor, pitchId: string, raw: unknown, ctx: RequestContext = {}) {
  requirePermission(actor, "platform.pitch");
  const input = parseInput(recordPitchSchema, raw);
  if (input.pitchDate > todayIst()) throw new AppError("VALIDATION", "Pitch date cannot be in the future.", { pitchDate: "Future date" });
  if (input.followUpOn && input.followUpOn < input.pitchDate) throw new AppError("VALIDATION", "Follow-up must be on or after the pitch date.", { followUpOn: "Too early" });
  await loadVisiblePitch(db, actor, pitchId, false);
  const [platform] = await db.select().from(platforms).where(eq(platforms.id, input.platformId));
  if (!platform?.active) throw new AppError("VALIDATION", "Unknown or disabled platform.", { platformId: "Invalid" });
  if (input.contactId) {
    const [c] = await db.select({ id: platformContacts.id }).from(platformContacts)
      .where(and(eq(platformContacts.id, input.contactId), eq(platformContacts.platformId, input.platformId), eq(platformContacts.active, true)));
    if (!c) throw new AppError("VALIDATION", "That contact does not belong to this platform.", { contactId: "Invalid" });
  }
  if (input.methodKey) await assertLookupKeys(db, "PITCH_METHOD", [input.methodKey], "methodKey");
  await assertVersionOfPitch(db, input.scriptVersionId, pitchId, "scriptVersionId");
  await assertVersionOfPitch(db, input.deckVersionId, pitchId, "deckVersionId");

  return db.transaction(async (tx) => {
    // Workflow first: fails unless CEO/COO approval happened and the actor holds the pitch (business rule 8).
    const wf = await performAction(tx, actor, pitchId, { action: "RECORD_PLATFORM_PITCH", expectedVersion: input.expectedVersion,
      platformId: input.platformId, ...(input.remarks ? { remarks: input.remarks } : {}) }, ctx, { viaTrackerService: true });
    const [{ r } = { r: 0 }] = await tx.select({ r: max(platformPitches.roundNo) }).from(platformPitches)
      .where(and(eq(platformPitches.pitchId, pitchId), eq(platformPitches.platformId, input.platformId)));
    const [pp] = await tx.insert(platformPitches).values({
      pitchId, platformId: input.platformId, roundNo: (r ?? 0) + 1, pitchedById: actor.userId, contactId: input.contactId ?? null,
      pitchDate: input.pitchDate, methodKey: input.methodKey ?? null, materialsSent: input.materialsSent,
      scriptVersionId: input.scriptVersionId ?? null, deckVersionId: input.deckVersionId ?? null, remarks: input.remarks ?? null,
      currentStatus: "PITCHED", nextFollowUpOn: input.followUpOn ?? null,
    }).returning({ id: platformPitches.id });
    await tx.insert(platformResponses).values({ platformPitchId: pp!.id, status: "PITCHED", responseDate: input.pitchDate, notes: input.remarks ?? null, recordedById: actor.userId });
    if (input.followUpOn) {
      await tx.insert(followUps).values({ platformPitchId: pp!.id, assigneeId: actor.userId, dueOn: input.followUpOn, note: `Follow up with ${platform.name}`, createdById: actor.userId });
    }
    await tx.insert(pitchParticipants).values({ pitchId, userId: actor.userId, reason: "PLATFORM_OWNER" }).onConflictDoNothing();
    await writeAudit(tx, { actorId: actor.userId, action: "platform.pitch_recorded", resourceType: "pitch", resourceId: pitchId,
      after: { platformPitchId: pp!.id, platform: platform.name, pitchDate: input.pitchDate, scriptVersionId: input.scriptVersionId } }, ctx);
    return { platformPitchId: pp!.id, version: wf.version };
  });
}

export const responseSchema = z.object({
  status: z.enum(PLATFORM_STATUSES),
  responseDate: dateStr,
  notes: opt(5000),
  nextFollowUpOn: dateStr.optional(),
  /** Required when status is APPROVED: the pitch moves to Platform Approved through the workflow engine. */
  expectedVersion: z.number().int().min(1).optional(),
}).strict();

export async function recordPlatformResponse(db: Db, actor: Actor, platformPitchId: string, raw: unknown, ctx: RequestContext = {}) {
  requirePermission(actor, "platform.record_response");
  const input = parseInput(responseSchema, raw);
  if (input.responseDate > todayIst()) throw new AppError("VALIDATION", "Response date cannot be in the future.", { responseDate: "Future date" });
  const [pp] = await db.select({ pp: platformPitches, platformName: platforms.name }).from(platformPitches)
    .innerJoin(platforms, eq(platforms.id, platformPitches.platformId)).where(eq(platformPitches.id, platformPitchId));
  if (!pp) throw notFound("Platform pitch");
  const pitch = await loadVisiblePitch(db, actor, pp.pp.pitchId, false);
  if (input.responseDate < pp.pp.pitchDate) throw new AppError("VALIDATION", "Response cannot be before the pitch date.", { responseDate: "Too early" });

  return db.transaction(async (tx) => {
    let version: number | undefined;
    if (input.status === "APPROVED" && pitch.currentStageKey === "PLATFORM_PITCHING") {
      if (!input.expectedVersion) throw new AppError("VALIDATION", "Reload the page and try again.", { expectedVersion: "Required" });
      const wf = await performAction(tx, actor, pitch.id, { action: "MARK_PLATFORM_APPROVED", expectedVersion: input.expectedVersion,
        platformId: pp.pp.platformId, remarks: input.notes ?? `${pp.platformName} approved` }, ctx, { viaTrackerService: true });
      version = wf.version;
    }
    // Append-only history (business rule 5); current_status is a projection of the latest response.
    const [resp] = await tx.insert(platformResponses).values({ platformPitchId, status: input.status, responseDate: input.responseDate,
      notes: input.notes ?? null, recordedById: actor.userId }).returning({ id: platformResponses.id });
    await tx.update(platformPitches).set({ currentStatus: input.status, ...(input.nextFollowUpOn !== undefined ? { nextFollowUpOn: input.nextFollowUpOn } : {}) })
      .where(eq(platformPitches.id, platformPitchId));
    if (input.nextFollowUpOn) {
      await tx.insert(followUps).values({ platformPitchId, assigneeId: pp.pp.pitchedById, dueOn: input.nextFollowUpOn,
        note: `Follow up with ${pp.platformName}`, createdById: actor.userId });
    }
    for (const userId of new Set([pitch.currentOwnerId, pp.pp.pitchedById].filter((u): u is string => Boolean(u) && u !== actor.userId))) {
      await notify(tx, { userId, type: "platform.response", pitchId: pitch.id, title: `${pp.platformName}: ${PLATFORM_STATUS_TEXT[input.status] ?? input.status} — "${pitch.title}"` });
    }
    await writeAudit(tx, { actorId: actor.userId, action: "platform.response_recorded", resourceType: "pitch", resourceId: pitch.id,
      before: { status: pp.pp.currentStatus }, after: { platformPitchId, platform: pp.platformName, status: input.status, responseId: resp!.id } }, ctx);
    return { responseId: resp!.id, ...(version !== undefined ? { version } : {}) };
  });
}

export async function pitchPlatformPitches(db: Db, actor: Actor, pitchId: string) {
  requirePermission(actor, "platform.view");
  await loadVisiblePitch(db, actor, pitchId, false);
  const rows = await db.select({ pp: platformPitches, platformName: platforms.name, pitchedBy: users.fullName, contactName: platformContacts.fullName,
    contactDesignation: platformContacts.designation })
    .from(platformPitches).innerJoin(platforms, eq(platforms.id, platformPitches.platformId)).innerJoin(users, eq(users.id, platformPitches.pitchedById))
    .leftJoin(platformContacts, eq(platformContacts.id, platformPitches.contactId))
    .where(eq(platformPitches.pitchId, pitchId)).orderBy(desc(platformPitches.pitchDate), desc(platformPitches.createdAt));
  if (!rows.length) return [];
  const ids = rows.map((r) => r.pp.id);
  const responses = await db.select({ id: platformResponses.id, platformPitchId: platformResponses.platformPitchId, status: platformResponses.status,
    responseDate: platformResponses.responseDate, notes: platformResponses.notes, recordedBy: users.fullName, createdAt: platformResponses.createdAt })
    .from(platformResponses).innerJoin(users, eq(users.id, platformResponses.recordedById))
    .where(inArray(platformResponses.platformPitchId, ids)).orderBy(asc(platformResponses.responseDate), asc(platformResponses.createdAt));
  const fus = await db.select({ id: followUps.id, platformPitchId: followUps.platformPitchId, dueOn: followUps.dueOn, note: followUps.note,
    completedAt: followUps.completedAt, outcome: followUps.outcome, assignee: users.fullName })
    .from(followUps).innerJoin(users, eq(users.id, followUps.assigneeId)).where(inArray(followUps.platformPitchId, ids)).orderBy(asc(followUps.dueOn));
  return rows.map((r) => ({ ...r.pp, platformName: r.platformName, pitchedBy: r.pitchedBy, contactName: r.contactName, contactDesignation: r.contactDesignation,
    responses: responses.filter((x) => x.platformPitchId === r.pp.id), followUps: fus.filter((x) => x.platformPitchId === r.pp.id) }));
}

/* ───────────── Follow-ups ───────────── */

export async function dueFollowUps(db: Db, actor: Actor, now = new Date(), onlyMine = true) {
  const today = todayIst(now);
  const conds = [isNull(followUps.completedAt), lte(followUps.dueOn, today), pitchVisibilityCondition(actor)];
  if (onlyMine || !can(actor, "pitch.view_all")) conds.push(eq(followUps.assigneeId, actor.userId));
  return db.select({ id: followUps.id, dueOn: followUps.dueOn, note: followUps.note, pitchId: pitches.id, title: pitches.title, platformName: platforms.name,
    assignee: users.fullName, overdue: sql<boolean>`${followUps.dueOn} < ${today}` })
    .from(followUps).innerJoin(platformPitches, eq(platformPitches.id, followUps.platformPitchId)).innerJoin(pitches, eq(pitches.id, platformPitches.pitchId))
    .innerJoin(platforms, eq(platforms.id, platformPitches.platformId)).innerJoin(users, eq(users.id, followUps.assigneeId))
    .where(and(...conds)).orderBy(asc(followUps.dueOn)).limit(200);
}

export async function completeFollowUp(db: Db, actor: Actor, id: string, raw: unknown, ctx: RequestContext = {}) {
  const { outcome } = parseInput(z.object({ outcome: z.string().trim().min(1).max(2000) }).strict(), raw);
  return db.transaction(async (tx) => {
    const [f] = await tx.select({ f: followUps, pitchId: platformPitches.pitchId }).from(followUps)
      .innerJoin(platformPitches, eq(platformPitches.id, followUps.platformPitchId)).where(eq(followUps.id, id)).for("update");
    if (!f) throw notFound("Follow-up");
    await loadVisiblePitch(tx, actor, f.pitchId, false);
    if (f.f.assigneeId !== actor.userId && !can(actor, "pitch.view_all")) throw new AppError("FORBIDDEN", "Only the assignee or management can complete this follow-up.");
    if (f.f.completedAt) throw new AppError("CONFLICT", "Already completed.");
    await tx.update(followUps).set({ completedAt: new Date(), outcome }).where(eq(followUps.id, id));
    await writeAudit(tx, { actorId: actor.userId, action: "platform.follow_up_completed", resourceType: "pitch", resourceId: f.pitchId, after: { followUpId: id } }, ctx);
    return { id };
  });
}
