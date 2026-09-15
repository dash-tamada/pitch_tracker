import { describe, expect, it } from "vitest";
import { DEFAULT_STAGES, DEFAULT_TRANSITIONS } from "@/server/config/default-workflow";
import { DEFAULT_ROLE_MATRIX, type RoleKey } from "@/server/modules/authz/permissions";
import type { Actor } from "@/server/modules/authz/policy";
import {
  authorizeTransition, availableActions, foldEvents, resolveOutcome, selectTransition, validateActionInput,
  validateRecipient, type PitchState, type TransitionRule,
} from "@/server/modules/workflow/rules";

const rules: TransitionRule[] = DEFAULT_TRANSITIONS.map((t, i) => ({
  id: String(i), fromStageKey: t.from, toStageKey: t.to, action: t.action, requiredPermission: t.permission,
  allowedRoleKeys: t.roles ?? null, requiresCurrentOwner: t.requiresCurrentOwner ?? true, requiresRemarks: t.requiresRemarks ?? false,
  requiresRejectionReason: t.requiresRejectionReason ?? false, requiresRecipient: t.requiresRecipient ?? false,
  recipientRoleKeys: t.recipientRoles ?? null, requiresChangeTypes: t.requiresChangeTypes ?? false,
  requiresPlatform: t.requiresPlatform ?? false, isApproval: t.isApproval ?? false,
}));
const stages = new Map(DEFAULT_STAGES.map((s) => [s.key, { key: s.key, category: s.category, requiresOwner: s.requiresOwner ?? true }]));

const actor = (id: string, role: RoleKey, clearance: Actor["clearance"] = "CONFIDENTIAL"): Actor => ({
  userId: id, roles: new Set([role]), permissions: new Set(DEFAULT_ROLE_MATRIX[role].permissions), clearance, mfaSatisfied: true,
});
const A = actor("a", "EMPLOYEE"), B = actor("b", "EMPLOYEE"), CEO = actor("ceo", "CEO", "RESTRICTED"), VIEWER = actor("v", "VIEWER");
const ADMIN = actor("adm", "ADMIN");
const settings = { allowSelfApproval: false };
const pitch = (over: Partial<PitchState> = {}): PitchState => ({
  id: "p", currentStageKey: "INITIAL_REVIEW", currentOwnerId: "a", pausedFromStageKey: null, createdById: "a",
  version: 1, confidentiality: "CONFIDENTIAL", ...over,
});
const code = (fn: () => unknown) => { try { fn(); return "OK"; } catch (e) { return (e as { code: string }).code; } };

describe("default workflow configuration", () => {
  it("every transition references existing stages", () => {
    for (const r of rules) {
      expect(stages.has(r.fromStageKey), r.fromStageKey).toBe(true);
      if (r.toStageKey) expect(stages.has(r.toStageKey), r.toStageKey).toBe(true);
    }
  });
  it("has no duplicate (from, action, to) triples", () => {
    const keys = rules.map((r) => `${r.fromStageKey}|${r.action}|${r.toStageKey}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
  it("every non-terminal stage has at least one way out; RELEASED has none", () => {
    for (const s of DEFAULT_STAGES) {
      const outs = rules.filter((r) => r.fromStageKey === s.key && r.toStageKey !== s.key);
      if (s.key === "RELEASED") expect(outs).toHaveLength(0);
      else expect(outs.length, s.key).toBeGreaterThan(0);
    }
  });
  it("every review/executive REJECT requires a rejection reason", () => {
    const rejects = rules.filter((r) => r.action === "REJECT");
    expect(rejects.length).toBeGreaterThanOrEqual(5);
    for (const r of rejects) expect(r.requiresRejectionReason).toBe(true);
  });
  it("only executive roles can send to platform, approve or greenlight", () => {
    for (const r of rules.filter((x) => x.isApproval)) expect(r.allowedRoleKeys).toEqual(["CEO", "COO", "SUPER_ADMIN"]);
  });
});

describe("selectTransition", () => {
  it("rejects actions not configured for the current stage (URL/API bypass)", () => {
    expect(code(() => selectTransition(rules, pitch(), { action: "SEND_TO_PLATFORM" }))).toBe("TRANSITION_NOT_ALLOWED");
    expect(code(() => selectTransition(rules, pitch({ currentStageKey: "SUBMITTED" }), { action: "GREENLIGHT" }))).toBe("TRANSITION_NOT_ALLOWED");
  });
  it("requires a target level when FORWARD has several", () => {
    expect(code(() => selectTransition(rules, pitch(), { action: "FORWARD" }))).toBe("VALIDATION");
    expect(selectTransition(rules, pitch(), { action: "FORWARD", toStageKey: "EXECUTIVE_REVIEW" }).toStageKey).toBe("EXECUTIVE_REVIEW");
  });
  it("cannot forward downward to an earlier level", () => {
    expect(code(() => selectTransition(rules, pitch({ currentStageKey: "SENIOR_REVIEW" }), { action: "FORWARD", toStageKey: "INITIAL_REVIEW" })))
      .toBe("TRANSITION_NOT_ALLOWED");
  });
});

describe("authorizeTransition", () => {
  const reject = selectTransition(rules, pitch(), { action: "REJECT" });
  it("only the current owner may act at employee levels", () => {
    expect(code(() => authorizeTransition(A, reject, pitch(), settings))).toBe("OK");
    expect(code(() => authorizeTransition(B, reject, pitch(), settings))).toBe("NOT_CURRENT_OWNER");
  });
  it("viewer and admin cannot make pitch decisions", () => {
    expect(code(() => authorizeTransition(VIEWER, reject, pitch({ currentOwnerId: "v" }), settings))).toBe("FORBIDDEN");
    expect(code(() => authorizeTransition(ADMIN, reject, pitch({ currentOwnerId: "adm" }), settings))).toBe("FORBIDDEN");
  });
  it("employees cannot perform CEO/COO actions even as owner", () => {
    const p = pitch({ currentStageKey: "EXECUTIVE_REVIEW", currentOwnerId: "a" });
    expect(code(() => authorizeTransition(A, selectTransition(rules, p, { action: "SEND_TO_PLATFORM" }), p, settings))).toBe("FORBIDDEN");
  });
  it("blocks self-approval unless policy allows it", () => {
    const p = pitch({ currentStageKey: "EXECUTIVE_REVIEW", currentOwnerId: "ceo", createdById: "ceo" });
    const t = selectTransition(rules, p, { action: "SEND_TO_PLATFORM" });
    expect(code(() => authorizeTransition(CEO, t, p, settings))).toBe("SELF_APPROVAL_BLOCKED");
    expect(code(() => authorizeTransition(CEO, t, p, { allowSelfApproval: true }))).toBe("OK");
  });
});

describe("validateActionInput", () => {
  const reject = selectTransition(rules, pitch(), { action: "REJECT" });
  it("rejection without category or reason fails (business rule 1)", () => {
    expect(code(() => validateActionInput(reject, { action: "REJECT", expectedVersion: 1 }))).toBe("VALIDATION");
    expect(code(() => validateActionInput(reject, { action: "REJECT", expectedVersion: 1, rejectionCategoryKey: "WEAK_STORY" }))).toBe("VALIDATION");
    expect(code(() => validateActionInput(reject, { action: "REJECT", expectedVersion: 1, rejectionCategoryKey: "WEAK_STORY", rejectionReason: "too short" }))).toBe("VALIDATION");
    expect(code(() => validateActionInput(reject, { action: "REJECT", expectedVersion: 1, rejectionCategoryKey: "WEAK_STORY", rejectionReason: "Second act collapses." }))).toBe("OK");
  });
  it("forward requires recipient and remarks (business rule 2)", () => {
    const f = selectTransition(rules, pitch(), { action: "FORWARD", toStageKey: "INTERNAL_REVIEW" });
    expect(code(() => validateActionInput(f, { action: "FORWARD", expectedVersion: 1, remarks: "Good" }))).toBe("VALIDATION");
    expect(code(() => validateActionInput(f, { action: "FORWARD", expectedVersion: 1, recipientId: "b" }))).toBe("VALIDATION");
  });
});

describe("validateRecipient", () => {
  const f = selectTransition(rules, pitch(), { action: "FORWARD", toStageKey: "EXECUTIVE_REVIEW" });
  const facts = (id: string, role: RoleKey, clearance: Actor["clearance"] = "CONFIDENTIAL") =>
    ({ id, active: true, roles: new Set([role]), permissions: new Set(DEFAULT_ROLE_MATRIX[role].permissions), clearance, participantReasons: [] });
  const input = { action: "FORWARD" as const, expectedVersion: 1, recipientId: "x", remarks: "r" };
  it("executive level only accepts CEO/COO recipients", () => {
    expect(code(() => validateRecipient(f, input, pitch(), A, facts("b", "EMPLOYEE")))).toBe("INVALID_RECIPIENT");
    expect(code(() => validateRecipient(f, input, pitch(), A, facts("ceo", "CEO", "RESTRICTED")))).toBe("OK");
  });
  it("cannot forward a RESTRICTED pitch to someone without clearance", () => {
    const t = selectTransition(rules, pitch(), { action: "FORWARD", toStageKey: "INTERNAL_REVIEW" });
    expect(code(() => validateRecipient(t, input, pitch({ confidentiality: "RESTRICTED" }), A, facts("b", "EMPLOYEE")))).toBe("INVALID_RECIPIENT");
  });
  it("cannot forward to self or to inactive users", () => {
    const t = selectTransition(rules, pitch(), { action: "FORWARD", toStageKey: "INTERNAL_REVIEW" });
    expect(code(() => validateRecipient(t, input, pitch(), A, facts("a", "EMPLOYEE")))).toBe("INVALID_RECIPIENT");
    expect(code(() => validateRecipient(t, input, pitch(), A, { ...facts("b", "EMPLOYEE"), active: false }))).toBe("INVALID_RECIPIENT");
    expect(code(() => validateRecipient(t, input, pitch(), A, null))).toBe("INVALID_RECIPIENT");
  });
});

describe("resolveOutcome & pause/resume", () => {
  it("hold remembers the stage and resume returns to it", () => {
    const p = pitch({ currentStageKey: "SENIOR_REVIEW" });
    const hold = resolveOutcome(selectTransition(rules, p, { action: "HOLD" }), p, { action: "HOLD", expectedVersion: 1 }, stages);
    expect(hold).toMatchObject({ toStageKey: "ON_HOLD", pausedFromStageKey: "SENIOR_REVIEW", toOwnerId: "a" });
    const held = pitch({ currentStageKey: "ON_HOLD", pausedFromStageKey: "SENIOR_REVIEW" });
    const resume = resolveOutcome(selectTransition(rules, held, { action: "RESUME" }), held, { action: "RESUME", expectedVersion: 2 }, stages);
    expect(resume).toMatchObject({ toStageKey: "SENIOR_REVIEW", pausedFromStageKey: null });
  });
  it("rejected pitches have no owner", () => {
    const p = pitch();
    const out = resolveOutcome(selectTransition(rules, p, { action: "REJECT" }), p, { action: "REJECT", expectedVersion: 1 }, stages);
    expect(out.toOwnerId).toBeNull();
  });
});

describe("availableActions (drives buttons and Kanban drops)", () => {
  it("non-owner employee sees nothing; owner sees review actions", () => {
    expect(availableActions(B, rules, pitch(), settings)).toHaveLength(0);
    const actions = new Set(availableActions(A, rules, pitch(), settings).map((a) => a.action));
    expect([...actions].sort()).toEqual(["ACCEPT", "FORWARD", "HOLD", "REJECT", "REQUEST_CHANGES"]);
  });
});

describe("foldEvents (business rule 20)", () => {
  it("rebuilds stage, owner and waiting-since from events", () => {
    const t = (m: number) => new Date(Date.UTC(2026, 8, 15, 0, m));
    const f = foldEvents([
      { seq: 3, fromStageKey: "INITIAL_REVIEW", toStageKey: "INTERNAL_REVIEW", toOwnerId: "b", createdAt: t(3) },
      { seq: 1, fromStageKey: null, toStageKey: "SUBMITTED", toOwnerId: "a", createdAt: t(1) },
      { seq: 2, fromStageKey: "SUBMITTED", toStageKey: "INITIAL_REVIEW", toOwnerId: "a", createdAt: t(2) },
      { seq: 4, fromStageKey: "INTERNAL_REVIEW", toStageKey: "INTERNAL_REVIEW", toOwnerId: "c", createdAt: t(4) },
      { seq: 5, fromStageKey: "INTERNAL_REVIEW", toStageKey: "ON_HOLD", toOwnerId: "c", createdAt: t(5) },
    ], stages);
    expect(f).toEqual({ currentStageKey: "ON_HOLD", currentOwnerId: "c", stageEnteredAt: t(5), pausedFromStageKey: "INTERNAL_REVIEW", lastEventSeq: 5 });
  });
});
