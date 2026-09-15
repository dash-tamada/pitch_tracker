/**
 * Dashboards, analytics, aging and management views. Every query is scoped by the same pitch visibility
 * policy as the rest of the app, so management sees the whole pipeline and employees see only their stories.
 * Durations are computed from workflow_events (the authoritative history), never from editable fields.
 */
import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import type { Db } from "@/server/db/client";
import { creators, pitches, platformPitches, platformResponses, platforms, users, workflowEvents, workflowStages } from "@/server/db/schema";
import { can, pitchVisibilityCondition, type Actor } from "@/server/modules/authz/policy";
import { getSettings } from "@/server/modules/settings/service";
import { dueFollowUps } from "@/server/modules/platforms/service";

const REVIEW_STAGES = ["INITIAL_REVIEW", "INTERNAL_REVIEW", "SENIOR_REVIEW"];
const inList = (vals: string[]) => sql.join(vals.map((v) => sql`${v}`), sql`, `);
/** Pitches visible to the actor, as a SQL fragment usable inside raw subqueries. */
const visibleIds = (actor: Actor) => sql`(SELECT "pitches"."id" FROM "pitches" WHERE ${pitchVisibilityCondition(actor)})`;

export async function dashboardSummary(db: Db, actor: Actor, now = new Date()) {
  const vis = pitchVisibilityCondition(actor);
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1) - 5.5 * 3600_000);
  const everReached = (stages: string[]) => sql<number>`count(*) FILTER (WHERE EXISTS (SELECT 1 FROM workflow_events we WHERE we.pitch_id = "pitches"."id" AND we.to_stage_key IN (${inList(stages)})))::int`;
  const didAction = (actions: string[]) => sql<number>`count(*) FILTER (WHERE EXISTS (SELECT 1 FROM workflow_events we WHERE we.pitch_id = "pitches"."id" AND we.action::text IN (${inList(actions)})))::int`;
  const now_ = (stages: string[]) => sql<number>`count(*) FILTER (WHERE "pitches"."current_stage_key" IN (${inList(stages)}))::int`;
  const [c] = await db.select({
    total: sql<number>`count(*)::int`,
    newThisMonth: sql<number>`count(*) FILTER (WHERE "pitches"."created_at" >= ${monthStart})::int`,
    newPitches: now_(["SUBMITTED"]),
    underReview: now_([...REVIEW_STAGES, "CHANGES_REQUESTED", "ON_HOLD"]),
    awaitingMyReview: sql<number>`count(*) FILTER (WHERE "pitches"."current_owner_id" = ${actor.userId} AND "pitches"."current_stage_key" IN (${inList(["SUBMITTED", ...REVIEW_STAGES, "EXECUTIVE_REVIEW", "CHANGES_REQUESTED"])}))::int`,
    awaitingCeo: sql<number>`count(*) FILTER (WHERE "pitches"."current_stage_key" = 'EXECUTIVE_REVIEW' AND EXISTS (SELECT 1 FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = "pitches"."current_owner_id" AND r.key = 'CEO'))::int`,
    awaitingCoo: sql<number>`count(*) FILTER (WHERE "pitches"."current_stage_key" = 'EXECUTIVE_REVIEW' AND EXISTS (SELECT 1 FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = "pitches"."current_owner_id" AND r.key = 'COO'))::int`,
    accepted: didAction(["ACCEPT"]),
    approvedByExecutive: everReached(["APPROVED_FOR_PLATFORM"]),
    rejected: now_(["REJECTED"]),
    sentToPlatforms: didAction(["RECORD_PLATFORM_PITCH"]),
    platformApproved: didAction(["MARK_PLATFORM_APPROVED"]),
    readyForDevelopment: now_(["READY_FOR_DEVELOPMENT", "PLATFORM_APPROVED"]),
    inDevelopment: now_(["DEVELOPMENT"]),
    greenlit: everReached(["GREENLIT"]),
    inProduction: now_(["GREENLIT", "PRE_PRODUCTION", "PRODUCTION", "POST_PRODUCTION"]),
    completed: now_(["COMPLETED", "RELEASED"]),
  }).from(pitches).where(vis);
  return c!;
}

/** Funnel: how many visible pitches ever reached each milestone. */
export async function funnel(db: Db, actor: Actor) {
  const milestone = (label: string, cond: ReturnType<typeof sql>) => ({ label, cond });
  const steps = [
    milestone("Submitted", sql`true`),
    milestone("Reviewed", sql`EXISTS (SELECT 1 FROM workflow_events we WHERE we.pitch_id = "pitches"."id" AND we.action::text IN ('ACCEPT','FORWARD','REJECT','REQUEST_CHANGES','HOLD'))`),
    milestone("Accepted", sql`EXISTS (SELECT 1 FROM workflow_events we WHERE we.pitch_id = "pitches"."id" AND we.action::text = 'ACCEPT')`),
    milestone("CEO/COO", sql`EXISTS (SELECT 1 FROM workflow_events we WHERE we.pitch_id = "pitches"."id" AND we.to_stage_key = 'EXECUTIVE_REVIEW')`),
    milestone("Platform", sql`EXISTS (SELECT 1 FROM workflow_events we WHERE we.pitch_id = "pitches"."id" AND we.action::text = 'RECORD_PLATFORM_PITCH')`),
    milestone("Platform approved", sql`EXISTS (SELECT 1 FROM workflow_events we WHERE we.pitch_id = "pitches"."id" AND we.action::text = 'MARK_PLATFORM_APPROVED')`),
    milestone("Development", sql`EXISTS (SELECT 1 FROM workflow_events we WHERE we.pitch_id = "pitches"."id" AND we.to_stage_key = 'DEVELOPMENT')`),
    milestone("Greenlit", sql`EXISTS (SELECT 1 FROM workflow_events we WHERE we.pitch_id = "pitches"."id" AND we.to_stage_key = 'GREENLIT')`),
    milestone("Production", sql`EXISTS (SELECT 1 FROM workflow_events we WHERE we.pitch_id = "pitches"."id" AND we.to_stage_key = 'PRODUCTION')`),
  ];
  const fields = Object.fromEntries(steps.map((s, i) => [`s${i}`, sql<number>`count(*) FILTER (WHERE ${s.cond})::int`]));
  const [row] = await db.select(fields as Record<string, ReturnType<typeof sql<number>>>).from(pitches).where(pitchVisibilityCondition(actor));
  return steps.map((s, i) => ({ label: s.label, count: Number((row as Record<string, number>)[`s${i}`] ?? 0) }));
}

export async function breakdowns(db: Db, actor: Actor, now = new Date()) {
  const vis = pitchVisibilityCondition(actor);
  const since = new Date(now.getTime() - 365 * 86_400_000);
  const byMonth = await db.select({ month: sql<string>`to_char(date_trunc('month', "pitches"."created_at" AT TIME ZONE 'Asia/Kolkata'), 'YYYY-MM')`, count: sql<number>`count(*)::int` })
    .from(pitches).where(and(vis, gte(pitches.createdAt, since))).groupBy(sql`1`).orderBy(sql`1`);
  const decisionsByMonth = await db.select({ month: sql<string>`to_char(date_trunc('month', ${workflowEvents.createdAt} AT TIME ZONE 'Asia/Kolkata'), 'YYYY-MM')`,
    accepted: sql<number>`count(*) FILTER (WHERE ${workflowEvents.action} = 'ACCEPT')::int`,
    rejected: sql<number>`count(*) FILTER (WHERE ${workflowEvents.action} = 'REJECT')::int`,
    approved: sql<number>`count(*) FILTER (WHERE ${workflowEvents.action} IN ('SEND_TO_PLATFORM','APPROVE'))::int` })
    .from(workflowEvents).where(and(sql`${workflowEvents.pitchId} IN ${visibleIds(actor)}`, gte(workflowEvents.createdAt, since))).groupBy(sql`1`).orderBy(sql`1`);
  const group = (col: typeof pitches.genreKey | typeof pitches.languageKey | typeof pitches.formatKey) =>
    db.select({ key: col, count: sql<number>`count(*)::int` }).from(pitches).where(vis).groupBy(col).orderBy(desc(sql`count(*)`));
  const [byGenre, byLanguage, byFormat] = await Promise.all([group(pitches.genreKey), group(pitches.languageKey), group(pitches.formatKey)]);
  const byStage = await db.select({ key: pitches.currentStageKey, name: workflowStages.name, count: sql<number>`count(*)::int` }).from(pitches)
    .leftJoin(workflowStages, and(eq(workflowStages.definitionId, pitches.workflowDefinitionId), eq(workflowStages.key, pitches.currentStageKey)))
    .where(vis).groupBy(pitches.currentStageKey, workflowStages.name, workflowStages.sortOrder).orderBy(workflowStages.sortOrder);
  const byCreator = await db.select({ creatorId: creators.id, name: creators.fullName, total: sql<number>`count(*)::int`,
    approved: sql<number>`count(*) FILTER (WHERE EXISTS (SELECT 1 FROM workflow_events we WHERE we.pitch_id = "pitches"."id" AND we.to_stage_key = 'APPROVED_FOR_PLATFORM'))::int` })
    .from(pitches).innerJoin(creators, eq(creators.id, pitches.creatorId)).where(vis).groupBy(creators.id, creators.fullName).orderBy(desc(sql`count(*)`)).limit(15);
  const byPlatform = await db.select({ platformId: platforms.id, name: platforms.name, pitched: sql<number>`count(*)::int`,
    interested: sql<number>`count(*) FILTER (WHERE EXISTS (SELECT 1 FROM platform_responses pr WHERE pr.platform_pitch_id = "platform_pitches"."id" AND pr.status IN ('INTERESTED','MEETING_REQUESTED','SECOND_DRAFT_REQUESTED','DEVELOPMENT_DISCUSSION')))::int`,
    approved: sql<number>`count(*) FILTER (WHERE ${platformPitches.currentStatus} IN ('APPROVED','READY_FOR_DEVELOPMENT','GREENLIT'))::int`,
    rejected: sql<number>`count(*) FILTER (WHERE ${platformPitches.currentStatus} = 'REJECTED')::int`,
    onHold: sql<number>`count(*) FILTER (WHERE ${platformPitches.currentStatus} = 'ON_HOLD')::int` })
    .from(platformPitches).innerJoin(platforms, eq(platforms.id, platformPitches.platformId)).innerJoin(pitches, eq(pitches.id, platformPitches.pitchId))
    .where(vis).groupBy(platforms.id, platforms.name).orderBy(desc(sql`count(*)`));
  const rate = (n: number, d: number) => (d ? Math.round((n / d) * 1000) / 10 : null);
  return {
    byMonth, decisionsByMonth, byGenre, byLanguage, byFormat, byStage,
    byCreator: byCreator.map((c) => ({ ...c, approvalRate: rate(c.approved, c.total) })),
    byPlatform: byPlatform.map((p) => ({ ...p, approvalRate: rate(p.approved, p.pitched) })),
  };
}

/**
 * Time metrics (days, averaged over pitches that have both events):
 *  - reviewTime: time a pitch spends in a review/executive stage before the next event moves it on
 *  - submissionToPlatform: SUBMIT → first RECORD_PLATFORM_PITCH
 *  - platformApprovalToDevelopment: MARK_PLATFORM_APPROVED → START_DEVELOPMENT
 *  - developmentToProduction: START_DEVELOPMENT → first arrival in PRODUCTION
 */
export async function timeMetrics(db: Db, actor: Actor) {
  const vis = visibleIds(actor);
  const between = (fromCond: string, toCond: string) => sql<string | null>`(
    SELECT round(avg(EXTRACT(EPOCH FROM (t.at - f.at)) / 86400)::numeric, 1) FROM
      (SELECT pitch_id, min(created_at) AS at FROM workflow_events WHERE ${sql.raw(fromCond)} AND pitch_id IN ${vis} GROUP BY pitch_id) f
      JOIN (SELECT pitch_id, min(created_at) AS at FROM workflow_events WHERE ${sql.raw(toCond)} GROUP BY pitch_id) t
      ON t.pitch_id = f.pitch_id AND t.at >= f.at)`;
  const [r] = await db.select({
    reviewTime: sql<string | null>`(
      SELECT round(avg(EXTRACT(EPOCH FROM (nxt.created_at - cur.created_at)) / 86400)::numeric, 1)
      FROM workflow_events cur
      JOIN LATERAL (SELECT created_at FROM workflow_events n WHERE n.pitch_id = cur.pitch_id AND n.seq > cur.seq ORDER BY n.seq LIMIT 1) nxt ON true
      WHERE cur.to_stage_key IN ('INITIAL_REVIEW','INTERNAL_REVIEW','SENIOR_REVIEW','EXECUTIVE_REVIEW') AND cur.pitch_id IN ${vis})`,
    submissionToPlatform: between("action = 'SUBMIT'", "action = 'RECORD_PLATFORM_PITCH'"),
    platformApprovalToDevelopment: between("action = 'MARK_PLATFORM_APPROVED'", "action = 'START_DEVELOPMENT'"),
    developmentToProduction: between("action = 'START_DEVELOPMENT'", "to_stage_key = 'PRODUCTION'"),
  }).from(sql`(SELECT 1) AS one`);
  const n = (v: string | null | undefined) => (v === null || v === undefined ? null : Number(v));
  return { reviewTime: n(r?.reviewTime), submissionToPlatform: n(r?.submissionToPlatform), platformApprovalToDevelopment: n(r?.platformApprovalToDevelopment), developmentToProduction: n(r?.developmentToProduction) };
}

export async function agingPitches(db: Db, actor: Actor, now = new Date()) {
  const t = (await getSettings(db)).aging_thresholds_days;
  const cutoff = new Date(now.getTime() - t.attention * 86_400_000);
  const rows = await db.select({ id: pitches.id, title: pitches.title, stageKey: pitches.currentStageKey, stageName: workflowStages.name, ownerId: pitches.currentOwnerId,
    ownerName: users.fullName, since: pitches.stageEnteredAt })
    .from(pitches).leftJoin(users, eq(users.id, pitches.currentOwnerId))
    .leftJoin(workflowStages, and(eq(workflowStages.definitionId, pitches.workflowDefinitionId), eq(workflowStages.key, pitches.currentStageKey)))
    .where(and(pitchVisibilityCondition(actor), sql`${pitches.stageEnteredAt} <= ${cutoff}`,
      sql`${pitches.currentStageKey} NOT IN ('REJECTED','RELEASED','COMPLETED')`)).orderBy(pitches.stageEnteredAt).limit(300);
  return rows.map((r) => {
    const days = Math.floor((now.getTime() - r.since.getTime()) / 86_400_000);
    return { ...r, days, level: days >= t.critical ? "critical" : days >= t.overdue ? "overdue" : "attention" };
  });
}

/** Employee dashboard (brief §33). */
export async function myWork(db: Db, actor: Actor, now = new Date()) {
  const vis = pitchVisibilityCondition(actor);
  const base = { id: pitches.id, title: pitches.title, stageKey: pitches.currentStageKey, stageName: workflowStages.name, badge: workflowStages.badge,
    ownerName: users.fullName, since: pitches.stageEnteredAt, updatedAt: pitches.updatedAt, priority: pitches.priority };
  const q = () => db.select(base).from(pitches).leftJoin(users, eq(users.id, pitches.currentOwnerId))
    .leftJoin(workflowStages, and(eq(workflowStages.definitionId, pitches.workflowDefinitionId), eq(workflowStages.key, pitches.currentStageKey)));
  const pending = await q().where(and(vis, eq(pitches.currentOwnerId, actor.userId), inArray(pitches.currentStageKey, ["SUBMITTED", ...REVIEW_STAGES, "EXECUTIVE_REVIEW"]))).orderBy(pitches.stageEnteredAt).limit(50);
  const assigned = await q().where(and(vis, eq(pitches.currentOwnerId, actor.userId))).orderBy(desc(pitches.updatedAt)).limit(50);
  const forwarded = await q().where(and(vis, sql`EXISTS (SELECT 1 FROM workflow_events we WHERE we.pitch_id = "pitches"."id" AND we.actor_id = ${actor.userId} AND we.action::text IN ('FORWARD','ACCEPT','SEND_BACK'))`))
    .orderBy(desc(pitches.updatedAt)).limit(50);
  const awaitingOthers = forwarded.filter((p) => !assigned.some((a) => a.id === p.id) && !["REJECTED", "RELEASED"].includes(p.stageKey));
  const changesRequested = await q().where(and(vis, eq(pitches.currentStageKey, "CHANGES_REQUESTED"),
    sql`("pitches"."current_owner_id" = ${actor.userId} OR EXISTS (SELECT 1 FROM workflow_events we WHERE we.pitch_id = "pitches"."id" AND we.actor_id = ${actor.userId}))`)).limit(50);
  const recentDecisions = await db.select({ pitchId: workflowEvents.pitchId, title: pitches.title, action: workflowEvents.action, at: workflowEvents.createdAt, by: users.fullName })
    .from(workflowEvents).innerJoin(pitches, eq(pitches.id, workflowEvents.pitchId)).innerJoin(users, eq(users.id, workflowEvents.actorId))
    .where(and(vis, inArray(workflowEvents.action, ["SEND_TO_PLATFORM", "APPROVE", "REJECT", "GREENLIGHT", "MARK_PLATFORM_APPROVED"]))).orderBy(desc(workflowEvents.createdAt)).limit(20);
  const activity = await db.select({ pitchId: workflowEvents.pitchId, title: pitches.title, action: workflowEvents.action, at: workflowEvents.createdAt, by: users.fullName })
    .from(workflowEvents).innerJoin(pitches, eq(pitches.id, workflowEvents.pitchId)).innerJoin(users, eq(users.id, workflowEvents.actorId))
    .where(vis).orderBy(desc(workflowEvents.createdAt)).limit(15);
  const followUps = await dueFollowUps(db, actor, now, true);
  const days = (d: Date) => Math.floor((now.getTime() - d.getTime()) / 86_400_000);
  return {
    pending: pending.map((p) => ({ ...p, days: days(p.since) })), assigned: assigned.map((p) => ({ ...p, days: days(p.since) })),
    forwarded, awaitingOthers, changesRequested, recentlyApproved: recentDecisions.filter((d) => d.action !== "REJECT"),
    recentlyRejected: recentDecisions.filter((d) => d.action === "REJECT"), activity, followUps,
    requiringAction: pending.length + followUps.length,
  };
}

/** CEO / COO management view (brief §21). */
export async function executiveView(db: Db, actor: Actor, now = new Date()) {
  const vis = pitchVisibilityCondition(actor);
  const avg = sql<string | null>`(SELECT round(avg(r.overall)::numeric, 1) FROM ratings r WHERE r.pitch_id = "pitches"."id")`;
  const base = { id: pitches.id, title: pitches.title, stageKey: pitches.currentStageKey, stageName: workflowStages.name, badge: workflowStages.badge,
    ownerName: users.fullName, since: pitches.stageEnteredAt, priority: pitches.priority, creatorName: creators.fullName, rating: avg };
  const q = () => db.select(base).from(pitches).innerJoin(creators, eq(creators.id, pitches.creatorId)).leftJoin(users, eq(users.id, pitches.currentOwnerId))
    .leftJoin(workflowStages, and(eq(workflowStages.definitionId, pitches.workflowDefinitionId), eq(workflowStages.key, pitches.currentStageKey)));
  const shape = <T extends { since: Date; rating: string | null }>(rows: T[]) => rows.map((r) => ({ ...r, rating: r.rating === null ? null : Number(r.rating), days: Math.floor((now.getTime() - r.since.getTime()) / 86_400_000) }));
  const pendingApprovals = shape(await q().where(and(vis, eq(pitches.currentStageKey, "EXECUTIVE_REVIEW"))).orderBy(pitches.stageEnteredAt).limit(100));
  const recommended = shape(await q().where(and(vis, inArray(pitches.currentStageKey, [...REVIEW_STAGES, "EXECUTIVE_REVIEW"]),
    sql`EXISTS (SELECT 1 FROM workflow_events we WHERE we.pitch_id = "pitches"."id" AND we.action = 'ACCEPT')`)).orderBy(desc(pitches.updatedAt)).limit(50));
  const highPriority = shape(await q().where(and(vis, inArray(pitches.priority, ["HIGH", "URGENT"]), sql`${pitches.currentStageKey} NOT IN ('REJECTED','RELEASED')`)).orderBy(desc(pitches.updatedAt)).limit(50));
  const stronglyRated = shape(await q().where(and(vis, sql`${avg} >= 4`, sql`${pitches.currentStageKey} NOT IN ('REJECTED','RELEASED')`)).orderBy(desc(avg)).limit(50));
  const platformReady = shape(await q().where(and(vis, eq(pitches.currentStageKey, "APPROVED_FOR_PLATFORM"))).orderBy(pitches.stageEnteredAt).limit(50));
  const platformResponsesRecent = await db.select({ pitchId: pitches.id, title: pitches.title, platform: platforms.name, status: platformResponses.status,
    date: platformResponses.responseDate, recordedBy: users.fullName })
    .from(platformResponses).innerJoin(platformPitches, eq(platformPitches.id, platformResponses.platformPitchId))
    .innerJoin(pitches, eq(pitches.id, platformPitches.pitchId)).innerJoin(platforms, eq(platforms.id, platformPitches.platformId))
    .innerJoin(users, eq(users.id, platformResponses.recordedById))
    .where(and(vis, sql`${platformResponses.status} <> 'PITCHED'`)).orderBy(desc(platformResponses.createdAt)).limit(30);
  const developmentPipeline = shape(await q().where(and(vis, inArray(pitches.currentStageKey, ["PLATFORM_APPROVED", "READY_FOR_DEVELOPMENT", "DEVELOPMENT"]))).orderBy(pitches.stageEnteredAt).limit(100));
  const productionPipeline = shape(await q().where(and(vis, inArray(pitches.currentStageKey, ["GREENLIT", "PRE_PRODUCTION", "PRODUCTION", "POST_PRODUCTION", "COMPLETED"]))).orderBy(pitches.stageEnteredAt).limit(100));
  return { pendingApprovals, recommended, highPriority, stronglyRated, platformReady, platformResponsesRecent, developmentPipeline, productionPipeline,
    canDecide: can(actor, "pitch.approve_executive") };
}
