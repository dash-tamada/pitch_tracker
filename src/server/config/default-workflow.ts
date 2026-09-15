/**
 * DEFAULT workflow definition (version 1). Seeded into workflow_stages / workflow_transitions.
 * At runtime the engine reads the database, never this file. Admins publish new versions.
 */
import type { Permission, RoleKey } from "@/server/modules/authz/permissions";

export type StageCategory = "INTAKE" | "REVIEW" | "EXECUTIVE" | "PLATFORM" | "DEVELOPMENT" | "PRODUCTION" | "PAUSED" | "TERMINAL";
export type WorkflowActionKey =
  | "SUBMIT" | "ASSIGN" | "FORWARD" | "ACCEPT" | "REJECT" | "REQUEST_CHANGES" | "HOLD" | "RESUME" | "APPROVE"
  | "SEND_TO_PLATFORM" | "SEND_BACK" | "RECORD_PLATFORM_PITCH" | "MARK_PLATFORM_APPROVED"
  | "MARK_READY_FOR_DEVELOPMENT" | "START_DEVELOPMENT" | "GREENLIGHT" | "ADVANCE" | "REOPEN";

export interface StageDef {
  key: string; name: string; category: StageCategory; badge: string;
  isTerminal?: boolean; requiresOwner?: boolean;
}

export interface TransitionDef {
  from: string;
  to: string | null;                 // null → return to pausedFromStage (RESUME)
  action: WorkflowActionKey;
  permission: Permission;
  roles?: RoleKey[];
  requiresCurrentOwner?: boolean;    // default true
  requiresRemarks?: boolean;
  requiresRejectionReason?: boolean;
  requiresRecipient?: boolean;
  recipientRoles?: RoleKey[];
  requiresChangeTypes?: boolean;
  requiresPlatform?: boolean;
  isApproval?: boolean;
}

export const DEFAULT_WORKFLOW_NAME = "Story Pipeline";
export const INITIAL_STAGE = "SUBMITTED";

export const DEFAULT_STAGES: StageDef[] = [
  { key: "SUBMITTED", name: "Submitted", category: "INTAKE", badge: "new" },
  { key: "INITIAL_REVIEW", name: "Initial Review", category: "REVIEW", badge: "under_review" },
  { key: "INTERNAL_REVIEW", name: "Internal Review", category: "REVIEW", badge: "under_review" },
  { key: "SENIOR_REVIEW", name: "Senior Review", category: "REVIEW", badge: "under_review" },
  { key: "EXECUTIVE_REVIEW", name: "CEO / CBO Review", category: "EXECUTIVE", badge: "awaiting_approval" },
  { key: "CHANGES_REQUESTED", name: "Changes Requested", category: "PAUSED", badge: "changes_requested" },
  { key: "ON_HOLD", name: "On Hold", category: "PAUSED", badge: "on_hold" },
  { key: "REJECTED", name: "Rejected", category: "TERMINAL", badge: "rejected", isTerminal: true, requiresOwner: false },
  { key: "APPROVED_FOR_PLATFORM", name: "Approved for Platform Pitching", category: "PLATFORM", badge: "approved" },
  { key: "PLATFORM_PITCHING", name: "Platform Pitching", category: "PLATFORM", badge: "platform" },
  { key: "PLATFORM_APPROVED", name: "Platform Approved", category: "PLATFORM", badge: "platform_approved" },
  { key: "READY_FOR_DEVELOPMENT", name: "Ready for Development", category: "DEVELOPMENT", badge: "ready_to_go" },
  { key: "DEVELOPMENT", name: "Development", category: "DEVELOPMENT", badge: "development" },
  { key: "GREENLIT", name: "Greenlit", category: "PRODUCTION", badge: "greenlit" },
  { key: "PRE_PRODUCTION", name: "Pre-Production", category: "PRODUCTION", badge: "production" },
  { key: "PRODUCTION", name: "Production", category: "PRODUCTION", badge: "production" },
  { key: "POST_PRODUCTION", name: "Post-Production", category: "PRODUCTION", badge: "production" },
  { key: "COMPLETED", name: "Completed", category: "PRODUCTION", badge: "completed" },
  { key: "RELEASED", name: "Released", category: "TERMINAL", badge: "released", isTerminal: true },
];

const REVIEW_STAGES = ["INITIAL_REVIEW", "INTERNAL_REVIEW", "SENIOR_REVIEW"] as const;
const EXEC: RoleKey[] = ["CEO", "CBO", "SUPER_ADMIN"];
const SENIOR_UP: RoleKey[] = ["SENIOR_EMPLOYEE", "CEO", "CBO", "SUPER_ADMIN"];
const REVIEWERS: RoleKey[] = ["EMPLOYEE", "SENIOR_EMPLOYEE", "CEO", "CBO", "SUPER_ADMIN"];

const LEVEL_ORDER = ["INITIAL_REVIEW", "INTERNAL_REVIEW", "SENIOR_REVIEW", "EXECUTIVE_REVIEW"] as const;
const RECIPIENTS_FOR: Record<(typeof LEVEL_ORDER)[number], RoleKey[]> = {
  INITIAL_REVIEW: REVIEWERS,
  INTERNAL_REVIEW: REVIEWERS,
  SENIOR_REVIEW: SENIOR_UP,
  EXECUTIVE_REVIEW: ["CEO", "CBO"],
};

function reviewTransitions(): TransitionDef[] {
  const out: TransitionDef[] = [];
  LEVEL_ORDER.forEach((stage, i) => {
    const isExec = stage === "EXECUTIVE_REVIEW";
    const ownerRule = isExec ? { roles: EXEC, requiresCurrentOwner: false } : {};

    if (!isExec) {
      // FORWARD: same level or any higher level (Employee → Senior / CEO / CBO)
      for (const target of LEVEL_ORDER.slice(i)) {
        out.push({ from: stage, to: target, action: "FORWARD", permission: "pitch.forward",
          requiresRemarks: true, requiresRecipient: true, recipientRoles: RECIPIENTS_FOR[target] });
      }
      // ACCEPT: recommend and pass to the next level
      const next = LEVEL_ORDER[i + 1]!;
      out.push({ from: stage, to: next, action: "ACCEPT", permission: "pitch.accept",
        requiresRemarks: true, requiresRecipient: true, recipientRoles: RECIPIENTS_FOR[next] });
    }
    out.push({ from: stage, to: "REJECTED", action: "REJECT", permission: "pitch.reject",
      requiresRemarks: false, requiresRejectionReason: true, ...ownerRule });
    out.push({ from: stage, to: "CHANGES_REQUESTED", action: "REQUEST_CHANGES", permission: "pitch.request_changes",
      requiresRemarks: true, requiresChangeTypes: true, ...ownerRule });
    out.push({ from: stage, to: "ON_HOLD", action: "HOLD", permission: "pitch.hold", requiresRemarks: true, ...ownerRule });
  });
  return out;
}

export const DEFAULT_TRANSITIONS: TransitionDef[] = [
  { from: "SUBMITTED", to: "INITIAL_REVIEW", action: "ASSIGN", permission: "pitch.forward",
    requiresCurrentOwner: false, requiresRecipient: true, recipientRoles: REVIEWERS },

  ...reviewTransitions(),

  { from: "CHANGES_REQUESTED", to: null, action: "RESUME", permission: "pitch.request_changes", requiresRemarks: true },
  { from: "ON_HOLD", to: null, action: "RESUME", permission: "pitch.hold", requiresRemarks: true },

  // CEO / CBO decisions
  { from: "EXECUTIVE_REVIEW", to: "APPROVED_FOR_PLATFORM", action: "SEND_TO_PLATFORM", permission: "pitch.send_to_platform",
    roles: EXEC, requiresCurrentOwner: false, requiresRemarks: true, requiresRecipient: true, isApproval: true },
  { from: "EXECUTIVE_REVIEW", to: "APPROVED_FOR_PLATFORM", action: "APPROVE", permission: "pitch.approve_executive",
    roles: EXEC, requiresCurrentOwner: false, requiresRemarks: true, requiresRecipient: true, isApproval: true },
  { from: "EXECUTIVE_REVIEW", to: "SENIOR_REVIEW", action: "SEND_BACK", permission: "pitch.approve_executive",
    roles: EXEC, requiresCurrentOwner: false, requiresRemarks: true, requiresRecipient: true, recipientRoles: SENIOR_UP },

  // Platform stage
  { from: "APPROVED_FOR_PLATFORM", to: "PLATFORM_PITCHING", action: "RECORD_PLATFORM_PITCH", permission: "platform.pitch",
    requiresPlatform: true },
  { from: "PLATFORM_PITCHING", to: "PLATFORM_PITCHING", action: "RECORD_PLATFORM_PITCH", permission: "platform.pitch",
    requiresPlatform: true },
  { from: "PLATFORM_PITCHING", to: "PLATFORM_APPROVED", action: "MARK_PLATFORM_APPROVED", permission: "platform.record_response",
    requiresPlatform: true, requiresRemarks: true },
  { from: "PLATFORM_PITCHING", to: "REJECTED", action: "REJECT", permission: "pitch.reject",
    roles: EXEC, requiresCurrentOwner: false, requiresRejectionReason: true },
  { from: "PLATFORM_PITCHING", to: "ON_HOLD", action: "HOLD", permission: "pitch.hold", requiresRemarks: true },
  { from: "PLATFORM_APPROVED", to: "READY_FOR_DEVELOPMENT", action: "MARK_READY_FOR_DEVELOPMENT", permission: "development.manage",
    roles: SENIOR_UP, requiresCurrentOwner: false, requiresRemarks: false },

  // Re-assignment so no pitch is ever stranded with an absent owner
  ...["APPROVED_FOR_PLATFORM", "PLATFORM_PITCHING", "PLATFORM_APPROVED", "READY_FOR_DEVELOPMENT", "DEVELOPMENT",
      "GREENLIT", "PRE_PRODUCTION", "PRODUCTION", "POST_PRODUCTION", "COMPLETED", "CHANGES_REQUESTED", "ON_HOLD"]
    .map<TransitionDef>((s) => ({ from: s, to: s, action: "ASSIGN", permission: "pitch.forward",
      roles: SENIOR_UP, requiresCurrentOwner: false, requiresRecipient: true, requiresRemarks: true })),
  ...REVIEW_STAGES.map<TransitionDef>((s) => ({ from: s, to: s, action: "ASSIGN", permission: "pitch.forward",
      roles: SENIOR_UP, requiresCurrentOwner: false, requiresRecipient: true, requiresRemarks: true })),
  { from: "EXECUTIVE_REVIEW", to: "EXECUTIVE_REVIEW", action: "ASSIGN", permission: "pitch.forward",
      roles: EXEC, requiresCurrentOwner: false, requiresRecipient: true, recipientRoles: ["CEO", "CBO"], requiresRemarks: true },

  // Development & production
  { from: "READY_FOR_DEVELOPMENT", to: "DEVELOPMENT", action: "START_DEVELOPMENT", permission: "development.manage",
    requiresCurrentOwner: false, requiresRecipient: true },
  { from: "DEVELOPMENT", to: "GREENLIT", action: "GREENLIGHT", permission: "pitch.approve_executive",
    roles: EXEC, requiresCurrentOwner: false, requiresRemarks: true, requiresRecipient: true, isApproval: true },
  { from: "GREENLIT", to: "PRE_PRODUCTION", action: "ADVANCE", permission: "production.manage", requiresCurrentOwner: false },
  { from: "PRE_PRODUCTION", to: "PRODUCTION", action: "ADVANCE", permission: "production.manage", requiresCurrentOwner: false },
  { from: "PRODUCTION", to: "POST_PRODUCTION", action: "ADVANCE", permission: "production.manage", requiresCurrentOwner: false },
  { from: "POST_PRODUCTION", to: "COMPLETED", action: "ADVANCE", permission: "production.manage", requiresCurrentOwner: false },
  { from: "COMPLETED", to: "RELEASED", action: "ADVANCE", permission: "production.manage", requiresCurrentOwner: false },

  { from: "REJECTED", to: "SENIOR_REVIEW", action: "REOPEN", permission: "pitch.reopen",
    requiresCurrentOwner: false, requiresRemarks: true, requiresRecipient: true, recipientRoles: SENIOR_UP },
];
