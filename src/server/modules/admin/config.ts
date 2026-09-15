/**
 * Admin configuration without code changes: lookups (genres, languages, rejection categories…), rating categories,
 * system settings, and versioned workflow definitions. In-flight pitches stay on the version they started with.
 */
import { and, asc, desc, eq, gte, lte, max, sql } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/server/db/client";
import { auditLogs, lookupValues, permissions, ratingCategories, systemSettings, users, workflowDefinitions, workflowStages, workflowTransitions } from "@/server/db/schema";
import { AppError, notFound } from "@/server/lib/errors";
import { decodeCursor, encodeCursor, parseInput } from "@/server/lib/validation";
import { requirePermission, type Actor } from "@/server/modules/authz/policy";
import { writeAudit, type RequestContext } from "@/server/modules/audit/service";
import { settingsSchema } from "@/server/modules/settings/service";

const LOOKUP_TYPES = ["GENRE", "SUB_GENRE", "LANGUAGE", "FORMAT", "REJECTION_CATEGORY", "CHANGE_REQUEST_TYPE", "DOCUMENT_CATEGORY", "IMAGE_CATEGORY", "BUDGET_RANGE", "TARGET_AUDIENCE", "PITCH_METHOD"] as const;
const KEY = z.string().trim().regex(/^[A-Z0-9_]{2,60}$/, "Use CAPITALS, digits and underscores");

export async function listLookups(db: Db, actor: Actor) {
  requirePermission(actor, "config.manage");
  return db.select().from(lookupValues).orderBy(asc(lookupValues.type), asc(lookupValues.sortOrder), asc(lookupValues.label));
}

export async function upsertLookup(db: Db, actor: Actor, raw: unknown, ctx: RequestContext = {}) {
  requirePermission(actor, "config.manage");
  const input = parseInput(z.object({ type: z.enum(LOOKUP_TYPES), key: KEY, label: z.string().trim().min(1).max(120),
    parentKey: KEY.optional(), sortOrder: z.number().int().min(0).max(10000).optional(), active: z.boolean().default(true) }).strict(), raw);
  return db.transaction(async (tx) => {
    const [existing] = await tx.select().from(lookupValues).where(and(eq(lookupValues.type, input.type), eq(lookupValues.key, input.key)));
    // Keys are referenced by historical records, so they are never renamed or deleted — only relabelled or deactivated.
    if (existing) {
      await tx.update(lookupValues).set({ label: input.label, parentKey: input.parentKey ?? existing.parentKey, sortOrder: input.sortOrder ?? existing.sortOrder, active: input.active })
        .where(eq(lookupValues.id, existing.id));
    } else {
      const [{ m } = { m: 0 }] = await tx.select({ m: max(lookupValues.sortOrder) }).from(lookupValues).where(eq(lookupValues.type, input.type));
      await tx.insert(lookupValues).values({ type: input.type, key: input.key, label: input.label, parentKey: input.parentKey ?? null, sortOrder: input.sortOrder ?? (m ?? 0) + 1, active: input.active });
    }
    await writeAudit(tx, { actorId: actor.userId, action: existing ? "config.lookup_updated" : "config.lookup_added", resourceType: "config", before: existing ?? undefined, after: input }, ctx);
    return { type: input.type, key: input.key };
  });
}

export async function upsertRatingCategory(db: Db, actor: Actor, raw: unknown, ctx: RequestContext = {}) {
  requirePermission(actor, "config.manage");
  const input = parseInput(z.object({ key: KEY, label: z.string().trim().min(1).max(120), sortOrder: z.number().int().min(0).max(1000).optional(), active: z.boolean().default(true) }).strict(), raw);
  return db.transaction(async (tx) => {
    const [existing] = await tx.select().from(ratingCategories).where(eq(ratingCategories.key, input.key));
    if (existing) await tx.update(ratingCategories).set({ label: input.label, active: input.active, sortOrder: input.sortOrder ?? existing.sortOrder }).where(eq(ratingCategories.id, existing.id));
    else await tx.insert(ratingCategories).values({ key: input.key, label: input.label, sortOrder: input.sortOrder ?? 100, active: input.active });
    await writeAudit(tx, { actorId: actor.userId, action: "config.rating_category_saved", resourceType: "config", after: input }, ctx);
    return { key: input.key };
  });
}

export async function getAllSettings(db: Db, actor: Actor) {
  requirePermission(actor, "config.manage");
  const rows = await db.select().from(systemSettings);
  return settingsSchema.parse(Object.fromEntries(rows.map((r) => [r.key, r.value])));
}

export async function updateSettings(db: Db, actor: Actor, raw: unknown, ctx: RequestContext = {}) {
  requirePermission(actor, "config.manage");
  const input = parseInput(settingsSchema.partial().strict(), raw);
  if (input.aging_thresholds_days) {
    const t = input.aging_thresholds_days;
    if (!(t.attention < t.overdue && t.overdue < t.critical)) throw new AppError("VALIDATION", "Thresholds must increase: attention < overdue < critical.");
  }
  // Loosening approval controls is a security-relevant change: Super Admin only.
  if ((input.allow_self_approval === true || input.executive_approval_mode === "ANY") && !actor.roles.has("SUPER_ADMIN")) {
    const current = await getAllSettings(db, actor);
    if ((input.allow_self_approval === true && !current.allow_self_approval) || (input.executive_approval_mode === "ANY" && current.executive_approval_mode === "ALL")) {
      throw new AppError("FORBIDDEN", "Only a Super Admin can relax approval rules.");
    }
  }
  return db.transaction(async (tx) => {
    const before = Object.fromEntries((await tx.select().from(systemSettings)).map((r) => [r.key, r.value]));
    for (const [key, value] of Object.entries(input)) {
      await tx.insert(systemSettings).values({ key, value: value as object, updatedById: actor.userId })
        .onConflictDoUpdate({ target: systemSettings.key, set: { value: value as object, updatedById: actor.userId } });
    }
    await writeAudit(tx, { actorId: actor.userId, action: "config.settings_changed", resourceType: "config",
      before: Object.fromEntries(Object.keys(input).map((k) => [k, before[k]])), after: input }, ctx);
    return input;
  });
}

/* ───────────── Workflow versions ───────────── */

export async function getActiveWorkflow(db: Db, actor: Actor) {
  requirePermission(actor, "workflow.manage");
  const [def] = await db.select().from(workflowDefinitions).where(eq(workflowDefinitions.isActive, true));
  if (!def) throw notFound("Workflow");
  const stages = await db.select().from(workflowStages).where(eq(workflowStages.definitionId, def.id)).orderBy(asc(workflowStages.sortOrder));
  const transitions = await db.select().from(workflowTransitions).where(eq(workflowTransitions.definitionId, def.id)).orderBy(asc(workflowTransitions.fromStageKey), asc(workflowTransitions.action));
  const versions = await db.select({ id: workflowDefinitions.id, version: workflowDefinitions.version, isActive: workflowDefinitions.isActive, createdAt: workflowDefinitions.createdAt })
    .from(workflowDefinitions).orderBy(desc(workflowDefinitions.version));
  return { definition: def, stages, transitions, versions };
}

const stageInput = z.object({ key: KEY, name: z.string().trim().min(1).max(120), category: z.enum(["INTAKE", "REVIEW", "EXECUTIVE", "PLATFORM", "DEVELOPMENT", "PRODUCTION", "PAUSED", "TERMINAL"]),
  badge: z.string().max(40).nullable().optional(), isTerminal: z.boolean().default(false), requiresOwner: z.boolean().default(true) }).strict();
const ACTIONS = ["ASSIGN", "FORWARD", "ACCEPT", "REJECT", "REQUEST_CHANGES", "HOLD", "RESUME", "APPROVE", "SEND_TO_PLATFORM", "SEND_BACK", "RECORD_PLATFORM_PITCH",
  "MARK_PLATFORM_APPROVED", "MARK_READY_FOR_DEVELOPMENT", "START_DEVELOPMENT", "GREENLIGHT", "ADVANCE", "REOPEN"] as const;
const transitionInput = z.object({
  fromStageKey: KEY, toStageKey: KEY.nullable(), action: z.enum(ACTIONS), requiredPermission: z.string().max(60),
  allowedRoleKeys: z.array(KEY).max(10).nullable().default(null), requiresCurrentOwner: z.boolean(), requiresRemarks: z.boolean(),
  requiresRejectionReason: z.boolean(), requiresRecipient: z.boolean(), recipientRoleKeys: z.array(KEY).max(10).nullable().default(null),
  requiresChangeTypes: z.boolean(), requiresPlatform: z.boolean(), isApproval: z.boolean(),
}).strict();
export const publishWorkflowSchema = z.object({ name: z.string().trim().min(1).max(120), initialStageKey: KEY, stages: z.array(stageInput).min(2).max(60), transitions: z.array(transitionInput).min(1).max(400) }).strict();

/** Validates structural and security invariants, then publishes a new active version atomically. */
export async function publishWorkflowVersion(db: Db, actor: Actor, raw: unknown, ctx: RequestContext = {}) {
  requirePermission(actor, "workflow.manage");
  const input = parseInput(publishWorkflowSchema, raw);
  const keys = new Set(input.stages.map((s) => s.key));
  const problems: string[] = [];
  if (keys.size !== input.stages.length) problems.push("Stage keys must be unique.");
  if (!keys.has(input.initialStageKey)) problems.push("Initial stage must be one of the stages.");
  const perms = new Set((await db.select({ key: permissions.key }).from(permissions)).map((p) => p.key));
  const seen = new Set<string>();
  for (const t of input.transitions) {
    const id = `${t.fromStageKey}|${t.action}|${t.toStageKey ?? ""}`;
    if (seen.has(id)) problems.push(`Duplicate transition ${id}.`);
    seen.add(id);
    if (!keys.has(t.fromStageKey)) problems.push(`Unknown from-stage ${t.fromStageKey}.`);
    if (t.toStageKey !== null && !keys.has(t.toStageKey)) problems.push(`Unknown to-stage ${t.toStageKey}.`);
    if (t.toStageKey === null && t.action !== "RESUME") problems.push("Only RESUME may return to the previous stage.");
    if (!perms.has(t.requiredPermission)) problems.push(`Unknown permission ${t.requiredPermission}.`);
    // Non-negotiable business rules — configuration cannot switch them off.
    if (t.action === "REJECT" && !t.requiresRejectionReason) problems.push("Every REJECT must require a rejection reason.");
    if (t.action === "FORWARD" && !t.requiresRecipient) problems.push("Every FORWARD must require a recipient.");
    if (t.action === "MARK_PLATFORM_APPROVED" && !t.requiresPlatform) problems.push("Platform approval must require the platform.");
    if (["SEND_TO_PLATFORM", "APPROVE", "GREENLIGHT"].includes(t.action) && !t.isApproval) problems.push(`${t.action} must be marked as an approval.`);
  }
  if (problems.length) throw new AppError("VALIDATION", [...new Set(problems)].slice(0, 8).join(" "));

  return db.transaction(async (tx) => {
    const [{ v } = { v: 0 }] = await tx.select({ v: max(workflowDefinitions.version) }).from(workflowDefinitions).where(eq(workflowDefinitions.name, input.name));
    await tx.update(workflowDefinitions).set({ isActive: false }).where(eq(workflowDefinitions.isActive, true));
    const [def] = await tx.insert(workflowDefinitions).values({ name: input.name, version: (v ?? 0) + 1, isActive: true, initialStageKey: input.initialStageKey, createdById: actor.userId })
      .returning({ id: workflowDefinitions.id, version: workflowDefinitions.version });
    await tx.insert(workflowStages).values(input.stages.map((s, i) => ({ definitionId: def!.id, key: s.key, name: s.name, category: s.category, badge: s.badge ?? null,
      isTerminal: s.isTerminal, requiresOwner: s.requiresOwner, sortOrder: i })));
    await tx.insert(workflowTransitions).values(input.transitions.map((t) => ({ definitionId: def!.id, ...t })));
    await writeAudit(tx, { actorId: actor.userId, action: "workflow.version_published", resourceType: "workflow", resourceId: def!.id,
      after: { version: def!.version, stages: input.stages.length, transitions: input.transitions.length } }, ctx);
    return def!;
  });
}

/* ───────────── Audit log viewer ───────────── */

export const auditQuerySchema = z.object({
  action: z.string().max(80).optional(), resourceType: z.string().max(60).optional(), resourceId: z.uuid().optional(), actorId: z.uuid().optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  cursor: z.string().max(300).optional(), limit: z.coerce.number().int().min(1).max(200).default(50),
}).strict();

export async function queryAudit(db: Db, actor: Actor, raw: unknown) {
  requirePermission(actor, "audit.view");
  const f = parseInput(auditQuerySchema, raw);
  const conds = [];
  if (f.action) conds.push(sql`${auditLogs.action} LIKE ${`${f.action.replace(/[\\%_]/g, "\\$&")}%`}`);
  if (f.resourceType) conds.push(eq(auditLogs.resourceType, f.resourceType));
  if (f.resourceId) conds.push(eq(auditLogs.resourceId, f.resourceId));
  if (f.actorId) conds.push(eq(auditLogs.actorId, f.actorId));
  if (f.from) conds.push(gte(auditLogs.createdAt, new Date(`${f.from}T00:00:00+05:30`)));
  if (f.to) conds.push(lte(auditLogs.createdAt, new Date(new Date(`${f.to}T00:00:00+05:30`).getTime() + 86_400_000)));
  const cursor = decodeCursor(f.cursor);
  if (cursor) conds.push(sql`(${auditLogs.createdAt}, ${auditLogs.id}) < (${cursor.createdAt}, ${cursor.id})`);
  const rows = await db.select({ id: auditLogs.id, action: auditLogs.action, resourceType: auditLogs.resourceType, resourceId: auditLogs.resourceId,
    actorName: users.fullName, before: auditLogs.before, after: auditLogs.after, ip: auditLogs.ip, createdAt: auditLogs.createdAt })
    .from(auditLogs).leftJoin(users, eq(users.id, auditLogs.actorId)).where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(auditLogs.createdAt), desc(auditLogs.id)).limit(f.limit + 1);
  const page = rows.slice(0, f.limit);
  const last = page.at(-1);
  return { items: page, nextCursor: rows.length > f.limit && last ? encodeCursor(last.createdAt, last.id) : null };
}
