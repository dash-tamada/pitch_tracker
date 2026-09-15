/**
 * Development and production trackers. Stage changes always go through the workflow engine in the same transaction;
 * tracker rows hold the operational detail (owner, dates, budget, notes) and an append-only update history.
 */
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/server/db/client";
import {
  developmentProjects, developmentUpdates, pitchParticipants, pitches, platformPitches, platforms, productionProjects, productionUpdates, users, workflowEvents,
} from "@/server/db/schema";
import { AppError, notFound } from "@/server/lib/errors";
import { parseInput } from "@/server/lib/validation";
import { can, pitchVisibilityCondition, requirePermission, type Actor } from "@/server/modules/authz/policy";
import { writeAudit, type RequestContext } from "@/server/modules/audit/service";
import { loadVisiblePitch, performAction } from "@/server/modules/workflow/engine";

const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");
const opt = (max: number) => z.string().trim().max(max).optional().transform((v) => (v === "" ? undefined : v));
const DEV_STATUSES = ["READY_FOR_DEVELOPMENT", "DEVELOPMENT_STARTED", "SCRIPT_DEVELOPMENT", "CASTING_DEVELOPMENT", "PACKAGING", "AWAITING_APPROVAL", "DEVELOPMENT_COMPLETED"] as const;
const PROD_STAGE_TO_STATUS: Record<string, "GREENLIT" | "PRE_PRODUCTION" | "PRODUCTION" | "POST_PRODUCTION" | "COMPLETED" | "RELEASED"> = {
  GREENLIT: "GREENLIT", PRE_PRODUCTION: "PRE_PRODUCTION", PRODUCTION: "PRODUCTION", POST_PRODUCTION: "POST_PRODUCTION", COMPLETED: "COMPLETED", RELEASED: "RELEASED",
};

export const startDevelopmentSchema = z.object({
  expectedVersion: z.number().int().min(1), ownerId: z.uuid(), startDate: dateStr.optional(), expectedCompletion: dateStr.optional(),
  requirements: opt(5000), notes: opt(5000),
}).strict();

export async function startDevelopment(db: Db, actor: Actor, pitchId: string, raw: unknown, ctx: RequestContext = {}) {
  requirePermission(actor, "development.manage");
  const input = parseInput(startDevelopmentSchema, raw);
  if (input.startDate && input.expectedCompletion && input.expectedCompletion < input.startDate) {
    throw new AppError("VALIDATION", "Expected completion must be after the start date.", { expectedCompletion: "Too early" });
  }
  return db.transaction(async (tx) => {
    const wf = await performAction(tx, actor, pitchId, { action: "START_DEVELOPMENT", expectedVersion: input.expectedVersion, recipientId: input.ownerId,
      ...(input.notes ? { remarks: input.notes } : {}) }, ctx, { viaTrackerService: true });
    const approval = await tx.select({ platformId: workflowEvents.platformId }).from(workflowEvents)
      .where(and(eq(workflowEvents.pitchId, pitchId), eq(workflowEvents.action, "MARK_PLATFORM_APPROVED"))).orderBy(desc(workflowEvents.seq)).limit(1);
    const [approvedPp] = approval[0]?.platformId ? await tx.select({ id: platformPitches.id }).from(platformPitches)
      .where(and(eq(platformPitches.pitchId, pitchId), eq(platformPitches.platformId, approval[0].platformId))).orderBy(desc(platformPitches.roundNo)).limit(1) : [];
    const [dp] = await tx.insert(developmentProjects).values({ pitchId, platformPitchId: approvedPp?.id ?? null, ownerId: input.ownerId,
      startDate: input.startDate ?? null, expectedCompletion: input.expectedCompletion ?? null, status: "DEVELOPMENT_STARTED",
      requirements: input.requirements ?? null, notes: input.notes ?? null }).returning({ id: developmentProjects.id });
    await tx.insert(developmentUpdates).values({ developmentProjectId: dp!.id, status: "DEVELOPMENT_STARTED", kind: "STATUS", body: input.notes ?? "Development started", authorId: actor.userId });
    await tx.insert(pitchParticipants).values({ pitchId, userId: input.ownerId, reason: "DEVELOPMENT_OWNER", grantedById: actor.userId }).onConflictDoNothing();
    await writeAudit(tx, { actorId: actor.userId, action: "development.started", resourceType: "pitch", resourceId: pitchId, after: { developmentProjectId: dp!.id, ownerId: input.ownerId } }, ctx);
    return { developmentProjectId: dp!.id, version: wf.version };
  });
}

export const developmentUpdateSchema = z.object({
  status: z.enum(DEV_STATUSES).optional(),
  kind: z.enum(["NOTE", "MEETING", "PLATFORM_FEEDBACK", "STATUS", "REQUIREMENT"]),
  body: z.string().trim().min(1).max(10000),
  meetingAt: z.iso.datetime({ offset: true }).optional(),
  expectedCompletion: dateStr.optional(),
}).strict();

export async function addDevelopmentUpdate(db: Db, actor: Actor, projectId: string, raw: unknown, ctx: RequestContext = {}) {
  requirePermission(actor, "development.manage");
  const input = parseInput(developmentUpdateSchema, raw);
  return db.transaction(async (tx) => {
    const [dp] = await tx.select().from(developmentProjects).where(eq(developmentProjects.id, projectId)).for("update");
    if (!dp) throw notFound("Development project");
    await loadVisiblePitch(tx, actor, dp.pitchId, false);
    const status = input.status ?? dp.status;
    await tx.insert(developmentUpdates).values({ developmentProjectId: projectId, status, kind: input.kind, body: input.body,
      meetingAt: input.meetingAt ? new Date(input.meetingAt) : null, authorId: actor.userId });
    await tx.update(developmentProjects).set({ status, ...(input.expectedCompletion ? { expectedCompletion: input.expectedCompletion } : {}) }).where(eq(developmentProjects.id, projectId));
    await writeAudit(tx, { actorId: actor.userId, action: "development.updated", resourceType: "pitch", resourceId: dp.pitchId,
      before: { status: dp.status }, after: { status, kind: input.kind } }, ctx);
    return { id: projectId, status };
  });
}

export const greenlightSchema = z.object({
  expectedVersion: z.number().int().min(1), productionOwnerId: z.uuid(), remarks: z.string().trim().min(1).max(5000),
  productionCompany: opt(160), platformId: z.uuid().optional(), startDate: dateStr.optional(), expectedRelease: dateStr.optional(),
  budgetRupees: z.number().int().min(0).max(1e12).optional(),
}).strict();

export async function greenlight(db: Db, actor: Actor, pitchId: string, raw: unknown, ctx: RequestContext = {}) {
  const input = parseInput(greenlightSchema, raw);
  if (input.startDate && input.expectedRelease && input.expectedRelease < input.startDate) {
    throw new AppError("VALIDATION", "Expected release must be after the start date.", { expectedRelease: "Too early" });
  }
  if (input.platformId) {
    const [p] = await db.select({ id: platforms.id }).from(platforms).where(eq(platforms.id, input.platformId));
    if (!p) throw new AppError("VALIDATION", "Unknown platform.", { platformId: "Invalid" });
  }
  return db.transaction(async (tx) => {
    // The engine enforces CEO/COO role, self-approval policy and the DEVELOPMENT → GREENLIT transition.
    const wf = await performAction(tx, actor, pitchId, { action: "GREENLIGHT", expectedVersion: input.expectedVersion, recipientId: input.productionOwnerId, remarks: input.remarks }, ctx, { viaTrackerService: true });
    const approved = await tx.select({ platformId: workflowEvents.platformId }).from(workflowEvents)
      .where(and(eq(workflowEvents.pitchId, pitchId), eq(workflowEvents.action, "MARK_PLATFORM_APPROVED"))).orderBy(desc(workflowEvents.seq)).limit(1);
    const [prod] = await tx.insert(productionProjects).values({ pitchId, ownerId: input.productionOwnerId, productionCompany: input.productionCompany ?? null,
      platformId: input.platformId ?? approved[0]?.platformId ?? null, startDate: input.startDate ?? null, expectedRelease: input.expectedRelease ?? null,
      budgetPaise: input.budgetRupees !== undefined ? BigInt(input.budgetRupees) * 100n : null, status: "GREENLIT", notes: input.remarks }).returning({ id: productionProjects.id });
    await tx.insert(productionUpdates).values({ productionProjectId: prod!.id, status: "GREENLIT", body: input.remarks, authorId: actor.userId });
    const [dp] = await tx.select({ id: developmentProjects.id }).from(developmentProjects).where(eq(developmentProjects.pitchId, pitchId));
    if (dp) {
      await tx.update(developmentProjects).set({ status: "DEVELOPMENT_COMPLETED" }).where(eq(developmentProjects.id, dp.id));
      await tx.insert(developmentUpdates).values({ developmentProjectId: dp.id, status: "DEVELOPMENT_COMPLETED", kind: "STATUS", body: "Greenlit", authorId: actor.userId });
    }
    await tx.insert(pitchParticipants).values({ pitchId, userId: input.productionOwnerId, reason: "PRODUCTION_OWNER", grantedById: actor.userId }).onConflictDoNothing();
    await writeAudit(tx, { actorId: actor.userId, action: "production.greenlit", resourceType: "pitch", resourceId: pitchId,
      after: { productionProjectId: prod!.id, ownerId: input.productionOwnerId, budgetSet: input.budgetRupees !== undefined } }, ctx);
    return { productionProjectId: prod!.id, version: wf.version };
  });
}

export const advanceSchema = z.object({ expectedVersion: z.number().int().min(1), remarks: opt(5000), actualRelease: dateStr.optional() }).strict();

export async function advanceProduction(db: Db, actor: Actor, pitchId: string, raw: unknown, ctx: RequestContext = {}) {
  const input = parseInput(advanceSchema, raw);
  return db.transaction(async (tx) => {
    const wf = await performAction(tx, actor, pitchId, { action: "ADVANCE", expectedVersion: input.expectedVersion, ...(input.remarks ? { remarks: input.remarks } : {}) }, ctx, { viaTrackerService: true });
    const status = PROD_STAGE_TO_STATUS[wf.event.toStageKey];
    const [prod] = await tx.select().from(productionProjects).where(eq(productionProjects.pitchId, pitchId)).for("update");
    if (!prod || !status) throw new AppError("TRANSITION_NOT_ALLOWED", "This pitch has no production record.");
    if (status === "RELEASED" && !input.actualRelease && !prod.actualRelease) throw new AppError("VALIDATION", "Enter the actual release date.", { actualRelease: "Required" });
    await tx.update(productionProjects).set({ status, ...(input.actualRelease ? { actualRelease: input.actualRelease } : {}) }).where(eq(productionProjects.id, prod.id));
    await tx.insert(productionUpdates).values({ productionProjectId: prod.id, status, body: input.remarks ?? null, authorId: actor.userId });
    await writeAudit(tx, { actorId: actor.userId, action: "production.status_changed", resourceType: "pitch", resourceId: pitchId, before: { status: prod.status }, after: { status } }, ctx);
    return { status, version: wf.version };
  });
}

export const productionEditSchema = z.object({
  productionCompany: opt(160), startDate: dateStr.optional(), expectedRelease: dateStr.optional(), actualRelease: dateStr.optional(),
  budgetRupees: z.number().int().min(0).max(1e12).optional(), note: z.string().trim().min(1).max(10000),
}).strict();

export async function updateProductionDetails(db: Db, actor: Actor, projectId: string, raw: unknown, ctx: RequestContext = {}) {
  requirePermission(actor, "production.manage");
  const input = parseInput(productionEditSchema, raw);
  return db.transaction(async (tx) => {
    const [prod] = await tx.select().from(productionProjects).where(eq(productionProjects.id, projectId)).for("update");
    if (!prod) throw notFound("Production project");
    await loadVisiblePitch(tx, actor, prod.pitchId, false);
    if (input.budgetRupees !== undefined && !can(actor, "pitch.view_all")) throw new AppError("FORBIDDEN", "Only management can set budgets.");
    const patch: Record<string, unknown> = {};
    for (const k of ["productionCompany", "startDate", "expectedRelease", "actualRelease"] as const) if (input[k] !== undefined) patch[k] = input[k];
    if (input.budgetRupees !== undefined) patch.budgetPaise = BigInt(input.budgetRupees) * 100n;
    if (Object.keys(patch).length) await tx.update(productionProjects).set(patch).where(eq(productionProjects.id, projectId));
    await tx.insert(productionUpdates).values({ productionProjectId: projectId, status: prod.status, body: input.note, authorId: actor.userId });
    await writeAudit(tx, { actorId: actor.userId, action: "production.updated", resourceType: "pitch", resourceId: prod.pitchId, after: { fields: Object.keys(patch) } }, ctx);
    return { id: projectId };
  });
}

export async function pitchDevelopmentAndProduction(db: Db, actor: Actor, pitchId: string) {
  await loadVisiblePitch(db, actor, pitchId, false);
  const [dev] = await db.select({ d: developmentProjects, owner: users.fullName }).from(developmentProjects).innerJoin(users, eq(users.id, developmentProjects.ownerId))
    .where(eq(developmentProjects.pitchId, pitchId));
  const devUpdates = dev ? await db.select({ u: developmentUpdates, author: users.fullName }).from(developmentUpdates).innerJoin(users, eq(users.id, developmentUpdates.authorId))
    .where(eq(developmentUpdates.developmentProjectId, dev.d.id)).orderBy(asc(developmentUpdates.createdAt)) : [];
  const [prod] = await db.select({ p: productionProjects, owner: users.fullName, platformName: platforms.name }).from(productionProjects)
    .innerJoin(users, eq(users.id, productionProjects.ownerId)).leftJoin(platforms, eq(platforms.id, productionProjects.platformId))
    .where(eq(productionProjects.pitchId, pitchId));
  const prodUpdates = prod ? await db.select({ u: productionUpdates, author: users.fullName }).from(productionUpdates).innerJoin(users, eq(users.id, productionUpdates.authorId))
    .where(eq(productionUpdates.productionProjectId, prod.p.id)).orderBy(asc(productionUpdates.createdAt)) : [];
  const showBudget = can(actor, "pitch.view_all");
  return {
    development: dev ? { ...dev.d, ownerName: dev.owner, updates: devUpdates.map((x) => ({ ...x.u, author: x.author })) } : null,
    production: prod ? { ...prod.p, budgetRupees: showBudget && prod.p.budgetPaise !== null ? Number(prod.p.budgetPaise / 100n) : null, budgetPaise: undefined,
      ownerName: prod.owner, platformName: prod.platformName, updates: prodUpdates.map((x) => ({ ...x.u, author: x.author })) } : null,
  };
}

/** Pipelines for the Development / Production pages — only visible pitches. */
export async function developmentPipeline(db: Db, actor: Actor) {
  requirePermission(actor, "development.manage");
  const ready = await db.select({ id: pitches.id, title: pitches.title, stageEnteredAt: pitches.stageEnteredAt, ownerName: users.fullName })
    .from(pitches).leftJoin(users, eq(users.id, pitches.currentOwnerId))
    .where(and(pitchVisibilityCondition(actor), inArray(pitches.currentStageKey, ["PLATFORM_APPROVED", "READY_FOR_DEVELOPMENT"]))).orderBy(asc(pitches.stageEnteredAt));
  const active = await db.select({ id: pitches.id, title: pitches.title, status: developmentProjects.status, ownerName: users.fullName,
    startDate: developmentProjects.startDate, expectedCompletion: developmentProjects.expectedCompletion, stage: pitches.currentStageKey,
    platformName: platforms.name })
    .from(developmentProjects).innerJoin(pitches, eq(pitches.id, developmentProjects.pitchId)).innerJoin(users, eq(users.id, developmentProjects.ownerId))
    .leftJoin(platformPitches, eq(platformPitches.id, developmentProjects.platformPitchId)).leftJoin(platforms, eq(platforms.id, platformPitches.platformId))
    .where(and(pitchVisibilityCondition(actor), eq(pitches.currentStageKey, "DEVELOPMENT"))).orderBy(asc(developmentProjects.expectedCompletion));
  return { ready, active };
}

export async function productionPipeline(db: Db, actor: Actor) {
  requirePermission(actor, "production.manage");
  const rows = await db.select({ id: pitches.id, title: pitches.title, status: productionProjects.status, ownerName: users.fullName,
    productionCompany: productionProjects.productionCompany, platformName: platforms.name, startDate: productionProjects.startDate,
    expectedRelease: productionProjects.expectedRelease, actualRelease: productionProjects.actualRelease,
    budgetPaise: productionProjects.budgetPaise })
    .from(productionProjects).innerJoin(pitches, eq(pitches.id, productionProjects.pitchId)).innerJoin(users, eq(users.id, productionProjects.ownerId))
    .leftJoin(platforms, eq(platforms.id, productionProjects.platformId))
    .where(pitchVisibilityCondition(actor)).orderBy(asc(productionProjects.expectedRelease));
  const showBudget = can(actor, "pitch.view_all");
  return rows.map((r) => ({ ...r, budgetPaise: undefined, budgetRupees: showBudget && r.budgetPaise !== null ? Number(r.budgetPaise / 100n) : null }));
}

