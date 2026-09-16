/**
 * Pitch case files: create, edit, archive/restore, list with server-side filters, and the
 * "Where is this story now?" status derived from authoritative workflow data.
 */
import { assertCanAddPitch } from "@/server/modules/tenancy/limits";
import { and, asc, desc, eq, gte, ilike, inArray, isNotNull, isNull, lt, lte, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import type { Db, DbOrTx } from "@/server/db/client";
import { companies,
  creators, lookupValues, pitchCodeCounters, pitchParticipants, pitches, platformPitches, platforms, ratings, users,
  workflowDefinitions, workflowEvents, workflowStages,
} from "@/server/db/schema";
import { AppError, notFound } from "@/server/lib/errors";
import { decodeCursor, encodeCursor, PAGE_MAX, parseInput, type Page } from "@/server/lib/validation";
import { can, clearanceAllows, pitchVisibilityCondition, requirePermission, type Actor } from "@/server/modules/authz/policy";
import { writeAudit, type RequestContext } from "@/server/modules/audit/service";
import { escapeLike } from "@/server/modules/creators/service";
import { getSettings } from "@/server/modules/settings/service";
import { loadVisiblePitch } from "@/server/modules/workflow/engine";

const key = z.string().trim().min(1).max(60);
const opt = (max: number) => z.string().trim().max(max).optional().transform((v) => (v === "" ? undefined : v));

const pitchFields = {
  title: z.string().trim().min(1).max(200),
  logline: opt(500),
  shortSynopsis: opt(5000),
  detailedSynopsis: opt(100000),
  genreKey: key.optional().or(z.literal("").transform(() => undefined)),
  subGenreKey: key.optional().or(z.literal("").transform(() => undefined)),
  formatKey: key,
  languageKey: key,
  episodeCount: z.number().int().min(1).max(1000).optional(),
  episodeDurationMin: z.number().int().min(1).max(600).optional(),
  budgetRangeKey: key.optional().or(z.literal("").transform(() => undefined)),
  targetAudience: opt(200),
  priority: z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]),
  confidentiality: z.enum(["STANDARD", "CONFIDENTIAL", "RESTRICTED"]),
  tags: z.array(z.string().trim().min(1).max(40)).max(20),
  notes: opt(5000),
};

export const createPitchSchema = z.object({
  ...pitchFields,
  priority: pitchFields.priority.default("MEDIUM"),
  confidentiality: pitchFields.confidentiality.default("CONFIDENTIAL"),
  tags: pitchFields.tags.default([]),
  creatorId: z.uuid(),
}).strict();
export const updatePitchSchema = z.object(pitchFields).partial().extend({ expectedVersion: z.number().int().min(1) }).strict();

type LookupKind = "GENRE" | "SUB_GENRE" | "FORMAT" | "LANGUAGE" | "BUDGET_RANGE";

async function assertLookups(tx: DbOrTx, checks: [LookupKind, string | undefined][]) {
  for (const [type, k] of checks) {
    if (!k) continue;
    const [hit] = await tx.select({ key: lookupValues.key }).from(lookupValues)
      .where(and(eq(lookupValues.type, type), eq(lookupValues.key, k), eq(lookupValues.active, true)));
    if (!hit) throw new AppError("VALIDATION", "Unknown option selected.", { [type.toLowerCase()]: "Invalid" });
  }
}

export async function createPitch(db: Db, actor: Actor, raw: unknown, ctx: RequestContext = {}) {
  requirePermission(actor, "pitch.create");
  const input = parseInput(createPitchSchema, raw);
  if (!clearanceAllows(actor.clearance, input.confidentiality)) {
    throw new AppError("VALIDATION", "You cannot set a confidentiality level above your own clearance.", { confidentiality: "Too high" });
  }

  return db.transaction(async (tx) => {
    await assertLookups(tx, [["FORMAT", input.formatKey], ["LANGUAGE", input.languageKey], ["GENRE", input.genreKey],
      ["SUB_GENRE", input.subGenreKey], ["BUDGET_RANGE", input.budgetRangeKey]]);
    const [creator] = await tx.select({ id: creators.id }).from(creators).where(and(eq(creators.id, input.creatorId), isNull(creators.archivedAt)));
    if (!creator) throw new AppError("VALIDATION", "Creator not found.", { creatorId: "Invalid" });

    const [def] = await tx.select({ id: workflowDefinitions.id, initial: workflowDefinitions.initialStageKey })
      .from(workflowDefinitions).where(eq(workflowDefinitions.isActive, true));
    if (!def) throw new AppError("INTERNAL", "No active workflow is configured.");

    await assertCanAddPitch(tx);
    const year = new Date().getUTCFullYear();
    // Counters and codes are per company: each company numbers its own pitches (e.g. TAM-2026-000001).
    const [counter] = await tx.insert(pitchCodeCounters).values({ year, lastValue: 1 })
      .onConflictDoUpdate({ target: [pitchCodeCounters.companyId, pitchCodeCounters.year], set: { lastValue: sql`${pitchCodeCounters.lastValue} + 1` } })
      .returning({ lastValue: pitchCodeCounters.lastValue });
    const [company] = await tx.select({ code: companies.code, prefix: companies.pitchCodePrefix }).from(companies).where(eq(companies.id, sql`public.app_company_id()`));
    if (!company) throw new AppError("INTERNAL", "Company not found.");
    const pitchCode = `${company.prefix ?? company.code}-${year}-${String(counter!.lastValue).padStart(6, "0")}`;

    const [pitch] = await tx.insert(pitches).values({
      title: input.title, logline: input.logline ?? null, shortSynopsis: input.shortSynopsis ?? null, detailedSynopsis: input.detailedSynopsis ?? null,
      genreKey: input.genreKey ?? null, subGenreKey: input.subGenreKey ?? null, formatKey: input.formatKey, languageKey: input.languageKey,
      episodeCount: input.episodeCount ?? null, episodeDurationMin: input.episodeDurationMin ?? null, budgetRangeKey: input.budgetRangeKey ?? null,
      targetAudience: input.targetAudience ?? null, priority: input.priority, confidentiality: input.confidentiality, tags: input.tags,
      notes: input.notes ?? null, creatorId: input.creatorId,
      pitchCode, createdById: actor.userId, workflowDefinitionId: def.id, currentStageKey: def.initial, currentOwnerId: actor.userId, lastEventSeq: 1,
    }).returning({ id: pitches.id, pitchCode: pitches.pitchCode, version: pitches.version });

    await tx.insert(workflowEvents).values({ pitchId: pitch!.id, seq: 1, action: "SUBMIT", fromStageKey: null, toStageKey: def.initial,
      actorId: actor.userId, toOwnerId: actor.userId, remarks: "Story submitted" });
    await tx.insert(pitchParticipants).values({ pitchId: pitch!.id, userId: actor.userId, reason: "CREATED" });
    await writeAudit(tx, { actorId: actor.userId, action: "pitch.created", resourceType: "pitch", resourceId: pitch!.id,
      after: { pitchCode, title: input.title, creatorId: input.creatorId, confidentiality: input.confidentiality } }, ctx);
    return pitch!;
  });
}

const EDITABLE = ["title", "logline", "shortSynopsis", "detailedSynopsis", "genreKey", "subGenreKey", "formatKey", "languageKey", "episodeCount",
  "episodeDurationMin", "budgetRangeKey", "targetAudience", "priority", "confidentiality", "tags", "notes"] as const;

/** Editing metadata never touches stage/owner (only the workflow engine can). Every change is audited with before/after. */
export async function updatePitch(db: Db, actor: Actor, pitchId: string, raw: unknown, ctx: RequestContext = {}) {
  requirePermission(actor, "pitch.edit");
  const input = parseInput(updatePitchSchema, raw);
  return db.transaction(async (tx) => {
    await loadVisiblePitch(tx, actor, pitchId, true);
    const [before] = await tx.select().from(pitches).where(eq(pitches.id, pitchId));
    if (before!.archivedAt) throw new AppError("VALIDATION", "Restore the pitch before editing it.");
    if (before!.version !== input.expectedVersion) throw new AppError("STALE_VERSION", "This pitch was updated by someone else. Reload and try again.");
    // Only participants with edit rights or management may edit; the current owner or creator of the record always can.
    const isManager = can(actor, "pitch.view_all");
    if (!isManager && before!.currentOwnerId !== actor.userId && before!.createdById !== actor.userId) {
      throw new AppError("FORBIDDEN", "Only the current owner, the submitter or management can edit this pitch.");
    }
    if (input.confidentiality && !clearanceAllows(actor.clearance, input.confidentiality)) {
      throw new AppError("VALIDATION", "You cannot set a confidentiality level above your own clearance.", { confidentiality: "Too high" });
    }
    if (input.confidentiality && input.confidentiality !== before!.confidentiality && !isManager) {
      throw new AppError("FORBIDDEN", "Only management can change confidentiality.");
    }
    await assertLookups(tx, [["FORMAT", input.formatKey], ["LANGUAGE", input.languageKey], ["GENRE", input.genreKey],
      ["SUB_GENRE", input.subGenreKey], ["BUDGET_RANGE", input.budgetRangeKey]]);
    const patch: Record<string, unknown> = {};
    for (const k of EDITABLE) if (input[k] !== undefined && input[k] !== (before as Record<string, unknown>)[k]) patch[k] = input[k];
    if (!Object.keys(patch).length) return { id: pitchId, version: before!.version };
    const [u] = await tx.update(pitches).set({ ...patch, version: sql`${pitches.version} + 1` })
      .where(and(eq(pitches.id, pitchId), eq(pitches.version, input.expectedVersion))).returning({ version: pitches.version });
    if (!u) throw new AppError("STALE_VERSION", "This pitch was updated by someone else. Reload and try again.");
    const changed = Object.keys(patch);
    // Long text is summarised in the audit so the log does not become a second copy of confidential synopses.
    const summarise = (v: unknown) => (typeof v === "string" && v.length > 200 ? `[${v.length} characters]` : v);
    await writeAudit(tx, { actorId: actor.userId, action: "pitch.edited", resourceType: "pitch", resourceId: pitchId,
      before: Object.fromEntries(changed.map((k) => [k, summarise((before as Record<string, unknown>)[k])])),
      after: Object.fromEntries(changed.map((k) => [k, summarise(patch[k])])) }, ctx);
    return { id: pitchId, version: u.version };
  });
}

export async function setPitchArchived(db: Db, actor: Actor, pitchId: string, archived: boolean, ctx: RequestContext = {}) {
  requirePermission(actor, archived ? "pitch.archive" : "pitch.restore");
  return db.transaction(async (tx) => {
    await loadVisiblePitch(tx, actor, pitchId, true);
    const [p] = await tx.select({ archivedAt: pitches.archivedAt }).from(pitches).where(eq(pitches.id, pitchId));
    if (Boolean(p!.archivedAt) === archived) return { id: pitchId };
    await tx.update(pitches).set({ archivedAt: archived ? new Date() : null, archivedById: archived ? actor.userId : null, version: sql`${pitches.version} + 1` })
      .where(eq(pitches.id, pitchId));
    await writeAudit(tx, { actorId: actor.userId, action: archived ? "pitch.archived" : "pitch.restored", resourceType: "pitch", resourceId: pitchId }, ctx);
    return { id: pitchId };
  });
}

const csv = z.union([z.string(), z.array(z.string())]).transform((v) => (Array.isArray(v) ? v : v.split(",")).map((s) => s.trim()).filter(Boolean)).pipe(z.array(z.string().max(60)).max(30));
const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const listPitchesSchema = z.object({
  q: z.string().trim().max(120).optional(),
  stage: csv.optional(), genre: csv.optional(), language: csv.optional(), format: csv.optional(), priority: csv.optional(),
  creatorType: csv.optional(),
  ownerId: z.uuid().optional(),
  mine: z.enum(["1"]).optional(),
  creatorId: z.uuid().optional(),
  platformId: z.uuid().optional(),
  platformStatus: csv.optional(),
  createdFrom: dateStr.optional(), createdTo: dateStr.optional(),
  minDaysWaiting: z.coerce.number().int().min(0).max(3650).optional(),
  minRating: z.coerce.number().min(1).max(5).optional(),
  archived: z.enum(["1"]).optional(),
  sort: z.enum(["newest", "oldest", "waiting"]).default("newest"),
  cursor: z.string().max(300).optional(),
  limit: z.coerce.number().int().min(1).max(PAGE_MAX).default(25),
}).strict();
export type PitchFilters = z.infer<typeof listPitchesSchema>;

/** IST day boundaries → UTC instants. */
const istStart = (d: string) => new Date(`${d}T00:00:00+05:30`);
const istEndExclusive = (d: string) => new Date(istStart(d).getTime() + 86_400_000);

export function pitchFilterConditions(actor: Actor, f: PitchFilters, now = new Date()): SQL[] {
  const conds: SQL[] = [pitchVisibilityCondition(actor, f.archived === "1")];
  if (f.archived === "1") conds.push(isNotNull(pitches.archivedAt));
  if (f.q) {
    const like = `%${escapeLike(f.q)}%`;
    conds.push(or(ilike(pitches.title, like), ilike(pitches.pitchCode, like), ilike(creators.fullName, like), ilike(pitches.logline, like))!);
  }
  if (f.stage?.length) conds.push(inArray(pitches.currentStageKey, f.stage));
  if (f.genre?.length) conds.push(inArray(pitches.genreKey, f.genre));
  if (f.language?.length) conds.push(inArray(pitches.languageKey, f.language));
  if (f.format?.length) conds.push(inArray(pitches.formatKey, f.format));
  if (f.priority?.length) conds.push(inArray(pitches.priority, f.priority as ("LOW" | "MEDIUM" | "HIGH" | "URGENT")[]));
  if (f.creatorType?.length) conds.push(inArray(creators.creatorType, f.creatorType as never[]));
  if (f.ownerId) conds.push(eq(pitches.currentOwnerId, f.ownerId));
  if (f.mine) conds.push(eq(pitches.currentOwnerId, actor.userId));
  if (f.creatorId) conds.push(eq(pitches.creatorId, f.creatorId));
  if (f.createdFrom) conds.push(gte(pitches.createdAt, istStart(f.createdFrom)));
  if (f.createdTo) conds.push(lt(pitches.createdAt, istEndExclusive(f.createdTo)));
  if (f.minDaysWaiting !== undefined) conds.push(lte(pitches.stageEnteredAt, new Date(now.getTime() - f.minDaysWaiting * 86_400_000)));
  if (f.platformId || f.platformStatus?.length) {
    const pp = [sql`pp.pitch_id = "pitches"."id"`];
    if (f.platformId) pp.push(sql`pp.platform_id = ${f.platformId}`);
    if (f.platformStatus?.length) pp.push(sql`pp.current_status::text IN (${sql.join(f.platformStatus.map((s) => sql`${s}`), sql`, `)})`);
    conds.push(sql`EXISTS (SELECT 1 FROM platform_pitches pp WHERE ${sql.join(pp, sql` AND `)})`);
  }
  if (f.minRating !== undefined) {
    conds.push(sql`(SELECT avg(r.overall) FROM ratings r WHERE r.pitch_id = "pitches"."id") >= ${f.minRating}`);
  }
  return conds;
}

export async function listPitches(db: Db, actor: Actor, raw: unknown, now = new Date()) {
  if (!can(actor, "pitch.view") && !can(actor, "pitch.view_all")) throw new AppError("FORBIDDEN", "You do not have access to pitches.");
  const f = parseInput(listPitchesSchema, raw);
  const conds = pitchFilterConditions(actor, f, now);
  const cursor = decodeCursor(f.cursor);
  // Keyset pagination on the sort column + id, so every sort pages exactly with no duplicates or gaps.
  const col = f.sort === "waiting" ? pitches.stageEnteredAt : pitches.createdAt;
  const ascending = f.sort !== "newest";
  if (cursor) {
    conds.push(ascending
      ? or(sql`${col} > ${cursor.createdAt}`, and(eq(col, cursor.createdAt), sql`${pitches.id} > ${cursor.id}`))!
      : or(lt(col, cursor.createdAt), and(eq(col, cursor.createdAt), lt(pitches.id, cursor.id)))!);
  }
  const order = ascending ? [asc(col), asc(pitches.id)] : [desc(col), desc(pitches.id)];
  const rows = await db.select({
    id: pitches.id, pitchCode: pitches.pitchCode, title: pitches.title, formatKey: pitches.formatKey, languageKey: pitches.languageKey,
    genreKey: pitches.genreKey, priority: pitches.priority, confidentiality: pitches.confidentiality, currentStageKey: pitches.currentStageKey,
    currentOwnerId: pitches.currentOwnerId, ownerName: users.fullName, stageEnteredAt: pitches.stageEnteredAt, updatedAt: pitches.updatedAt,
    createdAt: pitches.createdAt, creatorId: pitches.creatorId, creatorName: creators.fullName, creatorType: creators.creatorType,
    stageName: workflowStages.name, stageBadge: workflowStages.badge, archivedAt: pitches.archivedAt,
    avgRating: sql<string | null>`(SELECT round(avg(r.overall)::numeric, 1) FROM ratings r WHERE r.pitch_id = "pitches"."id")`,
  }).from(pitches)
    .innerJoin(creators, eq(creators.id, pitches.creatorId))
    .leftJoin(users, eq(users.id, pitches.currentOwnerId))
    .leftJoin(workflowStages, and(eq(workflowStages.definitionId, pitches.workflowDefinitionId), eq(workflowStages.key, pitches.currentStageKey)))
    .where(and(...conds)).orderBy(...order).limit(f.limit + 1);
  const page = rows.slice(0, f.limit);
  const last = page.at(-1);
  const items = page.map((r) => ({ ...r, avgRating: r.avgRating === null ? null : Number(r.avgRating), daysWaiting: Math.floor((now.getTime() - r.stageEnteredAt.getTime()) / 86_400_000) }));
  const cursorTime = (r: typeof page[number]) => (f.sort === "waiting" ? r.stageEnteredAt : r.createdAt);
  return { items, nextCursor: rows.length > f.limit && last ? encodeCursor(cursorTime(last), last.id) : null } satisfies Page<unknown>;
}

/** "What happens next" wording per stage key (default workflow). Unknown stages fall back to the stage name. */
const NEXT_ACTION: Record<string, string> = {
  SUBMITTED: "Assign to a reviewer", INITIAL_REVIEW: "Reviewer decision", INTERNAL_REVIEW: "Reviewer decision", SENIOR_REVIEW: "Senior review decision",
  EXECUTIVE_REVIEW: "CEO / COO decision", CHANGES_REQUESTED: "Upload revised material, then resume", ON_HOLD: "Resume when ready",
  REJECTED: "None (can be reopened by management)", APPROVED_FOR_PLATFORM: "Pitch to a platform", PLATFORM_PITCHING: "Await platform response",
  PLATFORM_APPROVED: "Confirm ready for development", READY_FOR_DEVELOPMENT: "Development team to start", DEVELOPMENT: "Greenlight decision (CEO / COO)",
  GREENLIT: "Begin pre-production", PRE_PRODUCTION: "Begin production", PRODUCTION: "Move to post-production", POST_PRODUCTION: "Complete",
  COMPLETED: "Release", RELEASED: "None",
};

export async function getPitchDetail(db: Db, actor: Actor, pitchId: string, now = new Date()) {
  const visible = await loadVisiblePitch(db, actor, pitchId, false);
  const [p] = await db.select({ pitch: pitches, creatorName: creators.fullName, creatorType: creators.creatorType, ownerName: users.fullName,
    stageName: workflowStages.name, stageBadge: workflowStages.badge, stageCategory: workflowStages.category })
    .from(pitches).innerJoin(creators, eq(creators.id, pitches.creatorId)).leftJoin(users, eq(users.id, pitches.currentOwnerId))
    .leftJoin(workflowStages, and(eq(workflowStages.definitionId, pitches.workflowDefinitionId), eq(workflowStages.key, pitches.currentStageKey)))
    .where(eq(pitches.id, pitchId));
  if (!p) throw notFound("Pitch");

  const events = await db.select({ action: workflowEvents.action, toOwnerId: workflowEvents.toOwnerId, fromOwnerId: workflowEvents.fromOwnerId,
    actorId: workflowEvents.actorId, approvalType: workflowEvents.approvalType, platformId: workflowEvents.platformId, createdAt: workflowEvents.createdAt,
    rejectionCategoryKey: workflowEvents.rejectionCategoryKey, rejectionReason: workflowEvents.rejectionReason, toStageKey: workflowEvents.toStageKey })
    .from(workflowEvents).where(eq(workflowEvents.pitchId, pitchId)).orderBy(asc(workflowEvents.seq));
  const ownerSince = [...events].reverse().find((e) => e.toOwnerId !== e.fromOwnerId || e.action === "SUBMIT")?.createdAt ?? p.pitch.stageEnteredAt;
  const executive = [...events].reverse().find((e) => ["SEND_TO_PLATFORM", "APPROVE"].includes(e.action));
  const lastRejection = [...events].reverse().find((e) => e.action === "REJECT");
  const approvedPlatformEvent = [...events].reverse().find((e) => e.action === "MARK_PLATFORM_APPROVED");
  const [approvedPlatform] = approvedPlatformEvent?.platformId
    ? await db.select({ id: platforms.id, name: platforms.name }).from(platforms).where(eq(platforms.id, approvedPlatformEvent.platformId)) : [];
  const [latestPlatform] = await db.select({ name: platforms.name, status: platformPitches.currentStatus }).from(platformPitches)
    .innerJoin(platforms, eq(platforms.id, platformPitches.platformId)).where(eq(platformPitches.pitchId, pitchId)).orderBy(desc(platformPitches.updatedAt)).limit(1);
  const [rating] = await db.select({ avg: sql<string | null>`round(avg(${ratings.overall})::numeric, 1)`, n: sql<number>`count(*)::int` })
    .from(ratings).where(eq(ratings.pitchId, pitchId));
  const reviewers = await db.select({ id: users.id, name: users.fullName }).from(users)
    .where(inArray(users.id, [...new Set(events.map((e) => e.actorId))]));
  const settings = await getSettings(db);
  const days = Math.floor((now.getTime() - p.pitch.stageEnteredAt.getTime()) / 86_400_000);
  const t = settings.aging_thresholds_days;
  const aging = days >= t.critical ? "critical" : days >= t.overdue ? "overdue" : days >= t.attention ? "attention" : "ok";

  return {
    pitch: { ...p.pitch, detailedSynopsis: p.pitch.detailedSynopsis },
    creator: { id: p.pitch.creatorId, name: p.creatorName, type: p.creatorType },
    status: {
      stageKey: p.pitch.currentStageKey, stageName: p.stageName ?? p.pitch.currentStageKey, badge: p.stageBadge, category: p.stageCategory,
      currentLevel: p.stageCategory === "PLATFORM" && latestPlatform ? latestPlatform.name : p.stageName ?? p.pitch.currentStageKey,
      ownerId: p.pitch.currentOwnerId, ownerName: p.ownerName, ownerSince, stageSince: p.pitch.stageEnteredAt, daysInStage: days, aging,
      nextAction: NEXT_ACTION[p.pitch.currentStageKey] ?? p.stageName ?? "—",
      wasRejected: Boolean(lastRejection), rejection: lastRejection ? { categoryKey: lastRejection.rejectionCategoryKey, reason: lastRejection.rejectionReason, at: lastRejection.createdAt } : null,
      executiveDecision: executive ? { approvalType: executive.approvalType, at: executive.createdAt, by: reviewers.find((r) => r.id === executive.actorId)?.name ?? null } : null,
      approvedPlatform: approvedPlatform ?? null,
      // The "READY TO GO" banner is shown from platform approval until greenlight; production has its own status.
      readyToGo: ["READY_FOR_DEVELOPMENT", "DEVELOPMENT"].includes(p.pitch.currentStageKey) && Boolean(approvedPlatform),
      latestPlatform: latestPlatform ?? null,
      rating: rating?.avg === null || rating?.avg === undefined ? null : Number(rating.avg), ratingCount: rating?.n ?? 0,
      reviewers: reviewers.map((r) => r.name),
    },
    archived: Boolean(visible.archivedAt),
  };
}
