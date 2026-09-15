/**
 * Pure workflow rules — no database access, fully unit-testable.
 * The DB-backed engine (engine.ts) loads facts, then calls these functions.
 */
import { z } from "zod";
import { AppError } from "@/server/lib/errors";
import { can, canViewPitch, hasAnyRole, type Actor, type Clearance } from "@/server/modules/authz/policy";
import type { Permission } from "@/server/modules/authz/permissions";
import type { WorkflowActionKey } from "@/server/config/default-workflow";

export interface TransitionRule {
  id: string;
  fromStageKey: string;
  toStageKey: string | null;
  action: WorkflowActionKey;
  requiredPermission: string;
  allowedRoleKeys: string[] | null;
  requiresCurrentOwner: boolean;
  requiresRemarks: boolean;
  requiresRejectionReason: boolean;
  requiresRecipient: boolean;
  recipientRoleKeys: string[] | null;
  requiresChangeTypes: boolean;
  requiresPlatform: boolean;
  isApproval: boolean;
}

export interface PitchState {
  id: string;
  currentStageKey: string;
  currentOwnerId: string | null;
  pausedFromStageKey: string | null;
  createdById: string;
  version: number;
  confidentiality: Clearance;
}

export interface RecipientFacts {
  id: string;
  active: boolean;
  roles: ReadonlySet<string>;
  permissions: ReadonlySet<string>;
  clearance: Clearance;
  participantReasons: readonly string[];
}

export interface WorkflowSettings {
  allowSelfApproval: boolean;
}

const uuid = z.uuid();
const text = (max: number) => z.string().trim().min(1).max(max);

export const ratingInputSchema = z.object({
  overall: z.number().int().min(1).max(5),
  scores: z.array(z.object({ categoryKey: text(60), score: z.number().int().min(1).max(5) }).strict()).max(20).default([]),
  comments: z.string().trim().max(5000).optional(),
}).strict();

export const actionInputSchema = z.object({
  action: z.enum([
    "ASSIGN", "FORWARD", "ACCEPT", "REJECT", "REQUEST_CHANGES", "HOLD", "RESUME", "APPROVE", "SEND_TO_PLATFORM",
    "SEND_BACK", "RECORD_PLATFORM_PITCH", "MARK_PLATFORM_APPROVED", "MARK_READY_FOR_DEVELOPMENT",
    "START_DEVELOPMENT", "GREENLIGHT", "ADVANCE", "REOPEN",
  ]),
  expectedVersion: z.number().int().min(1),
  toStageKey: text(60).optional(),
  remarks: z.string().trim().max(10000).optional(),
  recommendation: z.string().trim().max(2000).optional(),
  recipientId: uuid.optional(),
  rejectionCategoryKey: text(60).optional(),
  rejectionReason: z.string().trim().max(10000).optional(),
  changeTypeKeys: z.array(text(60)).max(10).optional(),
  platformId: uuid.optional(),
  recommendedPlatformIds: z.array(uuid).max(20).optional(),
  rating: ratingInputSchema.optional(),
}).strict();   // unknown keys (e.g. "currentOwnerId", "role") are rejected → no mass assignment

export type ActionInput = z.infer<typeof actionInputSchema>;

export const MIN_REJECTION_REASON = 10;
export const EXECUTIVE_ROLE_KEYS = ["CEO", "CBO"] as const;

/** Choose the single transition matching (current stage, action[, target]). */
export function selectTransition(rules: readonly TransitionRule[], pitch: PitchState, input: Pick<ActionInput, "action" | "toStageKey">): TransitionRule {
  const candidates = rules.filter((r) => r.fromStageKey === pitch.currentStageKey && r.action === input.action);
  if (candidates.length === 0) {
    throw new AppError("TRANSITION_NOT_ALLOWED", `"${input.action}" is not allowed while the pitch is in ${pitch.currentStageKey}.`);
  }
  if (input.toStageKey) {
    const match = candidates.find((r) => (r.toStageKey ?? pitch.pausedFromStageKey) === input.toStageKey);
    if (!match) throw new AppError("TRANSITION_NOT_ALLOWED", `Cannot ${input.action} to ${input.toStageKey} from ${pitch.currentStageKey}.`);
    return match;
  }
  if (candidates.length > 1) {
    throw new AppError("VALIDATION", "Choose the level to send this pitch to.", { toStageKey: "Required" });
  }
  return candidates[0]!;
}

/** Permission, role, ownership and self-approval checks. Does not look at input fields. */
export function authorizeTransition(actor: Actor, rule: TransitionRule, pitch: PitchState, settings: WorkflowSettings): void {
  if (!can(actor, rule.requiredPermission as Permission) || !hasAnyRole(actor, rule.allowedRoleKeys)) {
    throw new AppError("FORBIDDEN", "You do not have permission to do this.");
  }
  if (rule.requiresCurrentOwner && pitch.currentOwnerId !== actor.userId) {
    throw new AppError("NOT_CURRENT_OWNER", "Only the person currently holding this pitch can do this.");
  }
  if (rule.isApproval && !settings.allowSelfApproval && pitch.createdById === actor.userId) {
    throw new AppError("SELF_APPROVAL_BLOCKED", "You cannot approve a pitch you submitted.");
  }
}

/** Required-field checks driven by the transition configuration. */
export function validateActionInput(rule: TransitionRule, input: ActionInput): void {
  const fields: Record<string, string> = {};
  if (rule.requiresRemarks && !input.remarks) fields.remarks = "Remarks are required.";
  if (rule.requiresRejectionReason) {
    if (!input.rejectionCategoryKey) fields.rejectionCategoryKey = "Choose a rejection category.";
    if (!input.rejectionReason || input.rejectionReason.length < MIN_REJECTION_REASON) {
      fields.rejectionReason = `Give a rejection reason of at least ${MIN_REJECTION_REASON} characters.`;
    }
  }
  if (rule.requiresRecipient && !input.recipientId) fields.recipientId = "Choose who receives this pitch.";
  if (rule.requiresChangeTypes && (!input.changeTypeKeys || input.changeTypeKeys.length === 0)) {
    fields.changeTypeKeys = "Choose at least one type of change.";
  }
  if (rule.requiresPlatform && !input.platformId) fields.platformId = "Choose the platform.";
  if (Object.keys(fields).length > 0) throw new AppError("VALIDATION", "Some required information is missing.", fields);
}

/** The recipient must be active, hold an allowed role, and be able to open the pitch once assigned. */
export function validateRecipient(rule: TransitionRule, input: ActionInput, pitch: PitchState, actor: Actor, recipient: RecipientFacts | null): void {
  if (!rule.requiresRecipient) return;
  if (!recipient || !recipient.active) throw new AppError("INVALID_RECIPIENT", "The selected person is not an active user.");
  if ((input.action === "FORWARD" || input.action === "ACCEPT") && recipient.id === actor.userId) {
    throw new AppError("INVALID_RECIPIENT", "You cannot forward a pitch to yourself.");
  }
  if (rule.recipientRoleKeys && rule.recipientRoleKeys.length > 0 && !rule.recipientRoleKeys.some((r) => recipient.roles.has(r))) {
    throw new AppError("INVALID_RECIPIENT", "The selected person does not have the right role for this level.");
  }
  const recipientActor: Actor = {
    userId: recipient.id, roles: recipient.roles, permissions: recipient.permissions,
    clearance: recipient.clearance, mfaSatisfied: true,
  };
  const wouldSee = canViewPitch(recipientActor, {
    confidentiality: pitch.confidentiality, currentOwnerId: recipient.id, archivedAt: null,
    participantReasons: [...recipient.participantReasons, "ASSIGNED"],
  });
  if (!wouldSee) throw new AppError("INVALID_RECIPIENT", "The selected person is not cleared to view this pitch.");
}

export interface StageInfo { key: string; category: string; requiresOwner: boolean }

export interface TransitionOutcome {
  toStageKey: string;
  toOwnerId: string | null;
  pausedFromStageKey: string | null;
  stageChanged: boolean;
}

export function resolveOutcome(rule: TransitionRule, pitch: PitchState, input: ActionInput, stages: ReadonlyMap<string, StageInfo>): TransitionOutcome {
  const toStageKey = rule.toStageKey ?? pitch.pausedFromStageKey;
  if (!toStageKey) throw new AppError("TRANSITION_NOT_ALLOWED", "This pitch has no stage to return to.");
  const target = stages.get(toStageKey);
  if (!target) throw new AppError("TRANSITION_NOT_ALLOWED", "The target stage is not part of this workflow.");
  const current = stages.get(pitch.currentStageKey);

  let pausedFromStageKey = pitch.pausedFromStageKey;
  if (target.category === "PAUSED" && current?.category !== "PAUSED") pausedFromStageKey = pitch.currentStageKey;
  if (target.category !== "PAUSED") pausedFromStageKey = null;

  const toOwnerId = rule.requiresRecipient ? input.recipientId! : target.requiresOwner ? pitch.currentOwnerId : null;
  return { toStageKey, toOwnerId, pausedFromStageKey, stageChanged: toStageKey !== pitch.currentStageKey };
}

/** Actions the actor may attempt right now (input-independent checks only). Drives UI buttons and Kanban drops. */
export function availableActions(actor: Actor, rules: readonly TransitionRule[], pitch: PitchState, settings: WorkflowSettings) {
  return rules
    .filter((r) => r.fromStageKey === pitch.currentStageKey)
    .filter((r) => {
      try { authorizeTransition(actor, r, pitch, settings); return true; } catch { return false; }
    })
    .map((r) => ({ action: r.action, toStageKey: r.toStageKey ?? pitch.pausedFromStageKey, requires: {
      remarks: r.requiresRemarks, rejectionReason: r.requiresRejectionReason, recipient: r.requiresRecipient,
      recipientRoles: r.recipientRoleKeys, changeTypes: r.requiresChangeTypes, platform: r.requiresPlatform,
    } }));
}

export interface FoldableEvent { seq: number; fromStageKey: string | null; toStageKey: string; toOwnerId: string | null; createdAt: Date }

/**
 * Rebuilds the pitch projection from its event log (business rule 20).
 * Used by the reconciliation job and tests to prove the projection is derivable.
 */
export function foldEvents(events: readonly FoldableEvent[], stages: ReadonlyMap<string, StageInfo>) {
  const ordered = [...events].sort((a, b) => a.seq - b.seq);
  let stage: string | null = null;
  let owner: string | null = null;
  let enteredAt: Date | null = null;
  let pausedFrom: string | null = null;
  for (const e of ordered) {
    const target = stages.get(e.toStageKey);
    const wasPaused = stage ? stages.get(stage)?.category === "PAUSED" : false;
    if (target?.category === "PAUSED" && !wasPaused) pausedFrom = stage;
    if (target?.category !== "PAUSED") pausedFrom = null;
    if (e.toStageKey !== stage) enteredAt = e.createdAt;
    stage = e.toStageKey;
    owner = e.toOwnerId;
  }
  return { currentStageKey: stage, currentOwnerId: owner, stageEnteredAt: enteredAt, pausedFromStageKey: pausedFrom, lastEventSeq: ordered.at(-1)?.seq ?? 0 };
}
