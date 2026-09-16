/**
 * Workflow engine — the ONLY code path that changes a pitch's stage or owner.
 * Every action: authorize → validate → one transaction (event + projection + participants + rating + audit + notifications).
 */
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { Db, DbOrTx } from "@/server/db/client";
import {
  jobOutbox, lookupValues, notifications, pitchParticipants, pitches, platforms, ratingCategories,
  ratingScores, ratings, workflowEvents, workflowStages, workflowTransitions,
} from "@/server/db/schema";
import { AppError, notFound } from "@/server/lib/errors";
import { can, canViewPitch, type Actor } from "@/server/modules/authz/policy";
import { loadUsersWithPermissions } from "@/server/modules/authz/actor";
import { writeAudit, type RequestContext } from "@/server/modules/audit/service";
import { getSettings } from "@/server/modules/settings/service";
import {
  actionInputSchema, authorizeTransition, availableActions, resolveOutcome, selectTransition,
  validateActionInput, validateRecipient, type PitchState, type StageInfo, type TransitionRule,
} from "./rules";

type LockedPitch = PitchState & { title: string; creatorId: string; workflowDefinitionId: string; lastEventSeq: number; archivedAt: Date | null };

async function loadStages(db: DbOrTx, definitionId: string): Promise<Map<string, StageInfo>> {
  const rows = await db.select({ key: workflowStages.key, category: workflowStages.category, requiresOwner: workflowStages.requiresOwner })
    .from(workflowStages).where(eq(workflowStages.definitionId, definitionId));
  return new Map(rows.map((r) => [r.key, r]));
}

async function loadRules(db: DbOrTx, definitionId: string, fromStageKey?: string): Promise<TransitionRule[]> {
  const where = fromStageKey
    ? and(eq(workflowTransitions.definitionId, definitionId), eq(workflowTransitions.fromStageKey, fromStageKey))
    : eq(workflowTransitions.definitionId, definitionId);
  return db.select().from(workflowTransitions).where(where);
}

async function participantReasons(db: DbOrTx, pitchId: string, userId: string): Promise<string[]> {
  const rows = await db.select({ reason: pitchParticipants.reason }).from(pitchParticipants)
    .where(and(eq(pitchParticipants.pitchId, pitchId), eq(pitchParticipants.userId, userId)));
  return rows.map((r) => r.reason);
}

/** Loads a pitch the actor is allowed to see, or throws NOT_FOUND (never reveals existence). */
async function loadVisiblePitch(db: DbOrTx, actor: Actor, pitchId: string, forUpdate: boolean): Promise<LockedPitch> {
  const q = db.select({
    id: pitches.id, title: pitches.title, creatorId: pitches.creatorId, currentStageKey: pitches.currentStageKey,
    currentOwnerId: pitches.currentOwnerId, pausedFromStageKey: pitches.pausedFromStageKey, createdById: pitches.createdById,
    version: pitches.version, confidentiality: pitches.confidentiality, workflowDefinitionId: pitches.workflowDefinitionId,
    lastEventSeq: pitches.lastEventSeq, archivedAt: pitches.archivedAt,
  }).from(pitches).where(eq(pitches.id, pitchId));
  const [row] = forUpdate ? await q.for("update") : await q;
  if (!row) throw notFound("Pitch");
  const reasons = await participantReasons(db, pitchId, actor.userId);
  if (!canViewPitch(actor, { ...row, participantReasons: reasons })) throw notFound("Pitch");
  return row;
}

export async function getAvailableActions(db: Db, actor: Actor, pitchId: string) {
  const pitch = await loadVisiblePitch(db, actor, pitchId, false);
  if (pitch.archivedAt) return [];
  const [rules, settings] = await Promise.all([loadRules(db, pitch.workflowDefinitionId, pitch.currentStageKey), getSettings(db)]);
  return availableActions(actor, rules, pitch, { allowSelfApproval: settings.allow_self_approval });
}

/**
 * Actions that must create tracker records (platform pitch, development/production project) in the same transaction.
 * They can only be performed through their services, never through the generic action endpoint, so the workflow
 * state and the tracker tables can never disagree.
 */
export const TRACKER_ACTIONS: ReadonlySet<string> = new Set(["RECORD_PLATFORM_PITCH", "MARK_PLATFORM_APPROVED", "START_DEVELOPMENT", "GREENLIGHT", "ADVANCE"]);

export async function performAction(db: DbOrTx, actor: Actor, pitchId: string, rawInput: unknown, ctx: RequestContext = {}, opts: { viaTrackerService?: boolean } = {}) {
  const parsed = actionInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    const fields: Record<string, string> = {};
    for (const issue of parsed.error.issues) fields[issue.path.join(".") || "_"] = issue.message;
    throw new AppError("VALIDATION", "The request is not valid.", fields);
  }
  const input = parsed.data;
  if (TRACKER_ACTIONS.has(input.action) && !opts.viaTrackerService) {
    throw new AppError("TRANSITION_NOT_ALLOWED", "Use the platform, development or production form for this step.");
  }
  if (!actor.mfaSatisfied) throw new AppError("MFA_REQUIRED", "Verify your second factor to continue.");

  try {
    return await db.transaction(async (tx) => {
      const pitch = await loadVisiblePitch(tx, actor, pitchId, true);
      if (pitch.archivedAt) throw new AppError("TRANSITION_NOT_ALLOWED", "Archived pitches must be restored first.");
      if (pitch.version !== input.expectedVersion) {
        throw new AppError("STALE_VERSION", "This pitch was updated by someone else. Reload and try again.");
      }

      // Sequential: a transaction uses one connection; parallel queries on it are unsafe.
      const rules = await loadRules(tx, pitch.workflowDefinitionId, pitch.currentStageKey);
      const stages = await loadStages(tx, pitch.workflowDefinitionId);
      const settings = await getSettings(tx);
      const rule = selectTransition(rules, pitch, input);
      authorizeTransition(actor, rule, pitch, { allowSelfApproval: settings.allow_self_approval });
      validateActionInput(rule, input);

      // Recipient
      let recipient = null;
      if (rule.requiresRecipient && input.recipientId) {
        const u = (await loadUsersWithPermissions(tx, [input.recipientId])).get(input.recipientId);
        recipient = u ? { id: u.id, active: u.status === "ACTIVE", roles: u.roles, permissions: u.permissions,
          clearance: u.clearance, participantReasons: await participantReasons(tx, pitch.id, u.id) } : null;
      }
      validateRecipient(rule, input, pitch, actor, recipient);

      // Referenced configuration must exist and be active
      if (rule.requiresRejectionReason) await assertLookup(tx, "REJECTION_CATEGORY", [input.rejectionCategoryKey!], "rejectionCategoryKey");
      if (input.changeTypeKeys?.length) await assertLookup(tx, "CHANGE_REQUEST_TYPE", input.changeTypeKeys, "changeTypeKeys");
      const platformIds = [...new Set([...(input.platformId ? [input.platformId] : []), ...(input.recommendedPlatformIds ?? [])])];
      if (platformIds.length) {
        const found = await tx.select({ id: platforms.id }).from(platforms).where(and(inArray(platforms.id, platformIds), eq(platforms.active, true)));
        if (found.length !== platformIds.length) throw new AppError("VALIDATION", "Unknown or inactive platform.", { platformId: "Invalid" });
      }

      let outcome = resolveOutcome(rule, pitch, input, stages);
      let metadata: Record<string, unknown> = {};
      // Executive approval mode ALL: both CEO and COO must approve. The first approval is recorded but the pitch stays
      // in executive review until an approver holding the other executive role approves.
      if (rule.isApproval && rule.fromStageKey === "EXECUTIVE_REVIEW" && settings.executive_approval_mode === "ALL") {
        const actorExecRoles = ["CEO", "COO"].filter((r) => actor.roles.has(r));
        const [entered] = await tx.select({ seq: workflowEvents.seq }).from(workflowEvents)
          .where(and(eq(workflowEvents.pitchId, pitch.id), eq(workflowEvents.toStageKey, "EXECUTIVE_REVIEW"), sql`${workflowEvents.fromStageKey} IS DISTINCT FROM 'EXECUTIVE_REVIEW'`))
          .orderBy(sql`${workflowEvents.seq} DESC`).limit(1);
        const priorApprovals = await tx.select({ approvalType: workflowEvents.approvalType, actorId: workflowEvents.actorId }).from(workflowEvents)
          .where(and(eq(workflowEvents.pitchId, pitch.id), inArray(workflowEvents.action, ["APPROVE", "SEND_TO_PLATFORM"]), sql`${workflowEvents.seq} > ${entered?.seq ?? 0}`));
        const covered = new Set([...priorApprovals.filter((a) => a.actorId !== actor.userId).map((a) => a.approvalType), ...actorExecRoles]);
        if (!(covered.has("CEO") && covered.has("COO"))) {
          outcome = { toStageKey: pitch.currentStageKey, toOwnerId: pitch.currentOwnerId, pausedFromStageKey: pitch.pausedFromStageKey, stageChanged: false };
          metadata = { partialApproval: true, awaiting: covered.has("CEO") ? "COO" : "CEO" };
        }
      }
      const seq = pitch.lastEventSeq + 1;
      const approvalType = rule.isApproval ? (["CEO", "COO"].find((r) => actor.roles.has(r)) ?? "DELEGATED") : null;

      const [event] = await tx.insert(workflowEvents).values({
        pitchId: pitch.id, seq, action: input.action,
        fromStageKey: pitch.currentStageKey, toStageKey: outcome.toStageKey,
        actorId: actor.userId, fromOwnerId: pitch.currentOwnerId, toOwnerId: outcome.toOwnerId,
        remarks: input.remarks ?? null, recommendation: input.recommendation ?? null,
        rejectionCategoryKey: rule.requiresRejectionReason ? input.rejectionCategoryKey! : null,
        rejectionReason: rule.requiresRejectionReason ? input.rejectionReason! : null,
        changeTypeKeys: input.changeTypeKeys ?? null, approvalType,
        recommendedPlatformIds: input.recommendedPlatformIds ?? null, platformId: input.platformId ?? null, metadata,
      }).returning();

      const updated = await tx.update(pitches).set({
        currentStageKey: outcome.toStageKey,
        currentOwnerId: outcome.toOwnerId,
        pausedFromStageKey: outcome.pausedFromStageKey,
        lastEventSeq: seq,
        version: sql`${pitches.version} + 1`,
        ...(outcome.stageChanged ? { stageEnteredAt: event!.createdAt } : {}),
      }).where(and(eq(pitches.id, pitch.id), eq(pitches.version, input.expectedVersion))).returning({ version: pitches.version });
      if (updated.length !== 1) throw new AppError("STALE_VERSION", "This pitch was updated by someone else. Reload and try again.");

      await tx.insert(pitchParticipants).values([
        { pitchId: pitch.id, userId: actor.userId, reason: "REVIEWED" as const },
        ...(outcome.toOwnerId && outcome.toOwnerId !== actor.userId
          ? [{ pitchId: pitch.id, userId: outcome.toOwnerId, reason: "ASSIGNED" as const, grantedById: actor.userId }] : []),
      ]).onConflictDoNothing();

      if (input.rating) {
        if (!can(actor, "rating.add")) throw new AppError("FORBIDDEN", "You do not have permission to add ratings.");
        const [r] = await tx.insert(ratings).values({
          creatorId: pitch.creatorId, pitchId: pitch.id, reviewerId: actor.userId, workflowEventId: event!.id,
          overall: input.rating.overall, comments: input.rating.comments ?? null,
        }).returning({ id: ratings.id });
        if (input.rating.scores.length) {
          const cats = await tx.select({ id: ratingCategories.id, key: ratingCategories.key }).from(ratingCategories)
            .where(and(inArray(ratingCategories.key, input.rating.scores.map((s) => s.categoryKey)), eq(ratingCategories.active, true)));
          const byKey = new Map(cats.map((c) => [c.key, c.id]));
          const rows = input.rating.scores.map((s) => {
            const categoryId = byKey.get(s.categoryKey);
            if (!categoryId) throw new AppError("VALIDATION", "Unknown rating category.", { rating: s.categoryKey });
            return { ratingId: r!.id, categoryId, score: s.score };
          });
          await tx.insert(ratingScores).values(rows);
        }
      }

      if (outcome.toOwnerId && outcome.toOwnerId !== actor.userId && outcome.toOwnerId !== pitch.currentOwnerId) {
        const [n] = await tx.insert(notifications).values({
          userId: outcome.toOwnerId, type: `workflow.${input.action.toLowerCase()}`,
          title: `"${pitch.title}" has been sent to you (${outcome.toStageKey.replaceAll("_", " ").toLowerCase()}).`,
          pitchId: pitch.id,
        }).returning({ id: notifications.id });
        // Email job carries only the notification id — never script or synopsis content.
        await tx.insert(jobOutbox).values({ type: "EMAIL_NOTIFICATION", payload: { notificationId: n!.id } });
      }

      // Submitter hears about executive decisions and rejections of the story they brought in.
      if (["SEND_TO_PLATFORM", "APPROVE", "REJECT", "GREENLIGHT"].includes(input.action) && pitch.createdById !== actor.userId && !metadata.partialApproval) {
        const verb = input.action === "REJECT" ? "was rejected" : input.action === "GREENLIGHT" ? "was greenlit" : `was approved by ${approvalType ?? "management"}`;
        const [n] = await tx.insert(notifications).values({ userId: pitch.createdById, type: `workflow.${input.action.toLowerCase()}`,
          title: `"${pitch.title}" ${verb}.`, pitchId: pitch.id }).returning({ id: notifications.id });
        await tx.insert(jobOutbox).values({ type: "EMAIL_NOTIFICATION", payload: { notificationId: n!.id } });
      }

      await writeAudit(tx, {
        actorId: actor.userId, action: `workflow.${input.action.toLowerCase()}`, resourceType: "pitch", resourceId: pitch.id,
        before: { stage: pitch.currentStageKey, ownerId: pitch.currentOwnerId, version: pitch.version },
        after: { stage: outcome.toStageKey, ownerId: outcome.toOwnerId, eventId: event!.id, seq,
          rejectionCategoryKey: event!.rejectionCategoryKey },
      }, ctx);

      return { event: event!, version: updated[0]!.version };
    });
  } catch (err) {
    // Concurrent writers racing on the same seq → treat as stale.
    if (typeof err === "object" && err && "code" in err && (err as { code?: string }).code === "23505") {
      throw new AppError("STALE_VERSION", "This pitch was updated by someone else. Reload and try again.");
    }
    throw err;
  }
}

async function assertLookup(db: DbOrTx, type: "REJECTION_CATEGORY" | "CHANGE_REQUEST_TYPE", keys: string[], field: string) {
  const unique = [...new Set(keys)];
  const found = await db.select({ key: lookupValues.key }).from(lookupValues)
    .where(and(eq(lookupValues.type, type), inArray(lookupValues.key, unique), eq(lookupValues.active, true)));
  if (found.length !== unique.length) throw new AppError("VALIDATION", "Unknown option selected.", { [field]: "Invalid" });
}

/**
 * Moves every open pitch owned by `fromUserId` to `toUserId` (used when an employee is disabled).
 * Each move is a normal ASSIGN event, so the journey, projection check and audit trail stay intact.
 * Caller must hold user.manage and pass an open transaction; the recipient must be active and able to see each pitch.
 */
export async function reassignOwnedPitches(tx: DbOrTx, actor: Actor, fromUserId: string, toUserId: string, ctx: RequestContext = {}) {
  if (!can(actor, "user.manage")) throw new AppError("FORBIDDEN", "You do not have permission to do this.");
  if (fromUserId === toUserId) throw new AppError("VALIDATION", "Choose a different person.", { reassignToUserId: "Invalid" });
  const u = (await loadUsersWithPermissions(tx, [toUserId])).get(toUserId);
  if (!u || u.status !== "ACTIVE") throw new AppError("INVALID_RECIPIENT", "The selected person is not an active user.");
  const owned = await tx.select({ id: pitches.id, title: pitches.title, stage: pitches.currentStageKey, version: pitches.version,
    lastEventSeq: pitches.lastEventSeq, confidentiality: pitches.confidentiality })
    .from(pitches).where(and(eq(pitches.currentOwnerId, fromUserId), isNull(pitches.archivedAt))).for("update");
  for (const p of owned) {
    const reasons = await participantReasons(tx, p.id, toUserId);
    const recipientActor: Actor = { userId: u.id, companyId: actor.companyId, scope: "COMPANY", roles: u.roles, permissions: u.permissions,
      clearance: u.clearance, mfaSatisfied: true };
    if (!canViewPitch(recipientActor, { confidentiality: p.confidentiality, currentOwnerId: toUserId, archivedAt: null, participantReasons: [...reasons, "ASSIGNED"] })) {
      throw new AppError("INVALID_RECIPIENT", `The selected person is not cleared to take over "${p.title}".`);
    }
    const seq = p.lastEventSeq + 1;
    const [event] = await tx.insert(workflowEvents).values({ pitchId: p.id, seq, action: "ASSIGN", fromStageKey: p.stage, toStageKey: p.stage,
      actorId: actor.userId, fromOwnerId: fromUserId, toOwnerId: toUserId, remarks: "Reassigned because the previous owner's account was disabled.",
      metadata: { reassignment: true } }).returning({ id: workflowEvents.id });
    await tx.update(pitches).set({ currentOwnerId: toUserId, lastEventSeq: seq, version: sql`${pitches.version} + 1` }).where(eq(pitches.id, p.id));
    await tx.insert(pitchParticipants).values({ pitchId: p.id, userId: toUserId, reason: "ASSIGNED", grantedById: actor.userId }).onConflictDoNothing();
    const [n] = await tx.insert(notifications).values({ userId: toUserId, type: "workflow.assign", pitchId: p.id,
      title: `"${p.title}" has been reassigned to you.` }).returning({ id: notifications.id });
    await tx.insert(jobOutbox).values({ type: "EMAIL_NOTIFICATION", payload: { notificationId: n!.id } });
    await writeAudit(tx, { actorId: actor.userId, action: "workflow.reassigned", resourceType: "pitch", resourceId: p.id,
      before: { ownerId: fromUserId }, after: { ownerId: toUserId, eventId: event!.id, seq } }, ctx);
  }
  return { reassigned: owned.length };
}

/** Timeline for a pitch the actor can see. */
export async function getTimeline(db: Db, actor: Actor, pitchId: string) {
  await loadVisiblePitch(db, actor, pitchId, false);
  return db.select().from(workflowEvents).where(eq(workflowEvents.pitchId, pitchId)).orderBy(asc(workflowEvents.seq));
}

export { loadStages, loadVisiblePitch };
