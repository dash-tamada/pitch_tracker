import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { systemSettings, workflowEvents } from "@/server/db/schema";
import { agingPitches, breakdowns, dashboardSummary, executiveView, funnel, myWork, timeMetrics } from "@/server/modules/analytics/service";
import { recordPlatformPitch, recordPlatformResponse } from "@/server/modules/platforms/service";
import { getPitchDetail } from "@/server/modules/pitches/service";
import { performAction } from "@/server/modules/workflow/engine";
import { closeDb, makePitch, makeTeam, makeUser, platformId, testDb, type TestUser } from "../helpers/db";

const db = testDb();
let team: Awaited<ReturnType<typeof makeTeam>>;
let solo: TestUser;
const code = async (p: Promise<unknown>) => { try { await p; return "OK"; } catch (e) { return (e as { code?: string }).code ?? String(e); } };

beforeAll(async () => {
  team = await makeTeam(db);
  // A fresh employee who only sees their own three pitches → deterministic numbers.
  solo = await makeUser(db, "Solo Employee", ["EMPLOYEE"]);
  const a = await makePitch(db, solo, { title: "Solo Approved", genreKey: "DRAMA" });
  let v = a.version;
  const s = async (u: TestUser, b: Record<string, unknown>) => { v = (await performAction(db, u.actor, a.id, { expectedVersion: v, ...b })).version; };
  await s(solo, { action: "ASSIGN", recipientId: solo.id });
  await s(solo, { action: "ACCEPT", recipientId: team.employeeB.id, remarks: "good" });
  await s(team.employeeB, { action: "FORWARD", toStageKey: "EXECUTIVE_REVIEW", recipientId: team.ceo.id, remarks: "up" });
  await s(team.ceo, { action: "SEND_TO_PLATFORM", recipientId: solo.id, remarks: "go" });
  const pp = await recordPlatformPitch(db, solo.actor, a.id, { expectedVersion: v, platformId: await platformId(db, "Sun NXT"), pitchDate: "2026-09-01" });
  await recordPlatformResponse(db, solo.actor, pp.platformPitchId, { status: "APPROVED", responseDate: "2026-09-02", expectedVersion: pp.version });

  const r = await makePitch(db, solo, { title: "Solo Rejected", genreKey: "THRILLER" });
  const rv = (await performAction(db, solo.actor, r.id, { expectedVersion: r.version, action: "ASSIGN", recipientId: solo.id })).version;
  await performAction(db, solo.actor, r.id, { expectedVersion: rv, action: "REJECT", rejectionCategoryKey: "BUDGET_CONCERN", rejectionReason: "Needs a far larger budget." });

  await makePitch(db, solo, { title: "Solo New", genreKey: "THRILLER" });
});
afterAll(closeDb);

describe("dashboard numbers come from real records and respect visibility", () => {
  it("summary cards", async () => {
    const s = await dashboardSummary(db, solo.actor);
    expect(s).toMatchObject({ total: 3, newPitches: 1, rejected: 1, accepted: 1, approvedByExecutive: 1, sentToPlatforms: 1, platformApproved: 1, readyForDevelopment: 1, awaitingMyReview: 1 });
    const ceo = await dashboardSummary(db, team.ceo.actor);
    expect(ceo.total).toBeGreaterThanOrEqual(3);
  });
  it("funnel is monotonic and matches milestones", async () => {
    const f = await funnel(db, solo.actor);
    expect(f.map((x) => x.count)).toEqual([3, 2, 1, 1, 1, 1, 0, 0, 0]);
  });
  it("breakdowns by genre / platform with approval rates", async () => {
    const b = await breakdowns(db, solo.actor);
    expect(b.byGenre).toEqual(expect.arrayContaining([{ key: "THRILLER", count: 2 }, { key: "DRAMA", count: 1 }]));
    expect(b.byPlatform).toEqual([expect.objectContaining({ name: "Sun NXT", pitched: 1, approved: 1, approvalRate: 100 })]);
    expect(b.decisionsByMonth.reduce((n, m) => n + m.rejected, 0)).toBe(1);
  });
  it("time metrics are non-negative numbers or null", async () => {
    const t = await timeMetrics(db, solo.actor);
    expect(t.submissionToPlatform).not.toBeNull();
    for (const v of Object.values(t)) if (v !== null) expect(v).toBeGreaterThanOrEqual(0);
  });
  it("my work and executive views", async () => {
    const w = await myWork(db, solo.actor);
    expect(w.pending.map((p) => p.title)).toEqual(["Solo New"]);
    expect(w.forwarded.map((p) => p.title)).toContain("Solo Approved");
    expect(w.recentlyRejected.map((p) => p.title)).toContain("Solo Rejected");
    const e = await executiveView(db, team.ceo.actor);
    expect(e.canDecide).toBe(true);
    expect(e.platformResponsesRecent.some((r) => r.title === "Solo Approved" && r.status === "APPROVED")).toBe(true);
  });
  it("aging uses configured thresholds", async () => {
    const future = new Date(Date.now() + 8 * 86_400_000);
    const rows = await agingPitches(db, solo.actor, future);
    expect(rows.find((r) => r.title === "Solo New")).toMatchObject({ level: "overdue" });
    expect(rows.some((r) => r.title === "Solo Rejected")).toBe(false);
  });
  it("where-is-it-now status for a platform-approved story", async () => {
    const d = await getPitchDetail(db, solo.actor, (await myWork(db, solo.actor)).assigned.find((p) => p.title === "Solo Approved")!.id);
    expect(d.status).toMatchObject({ stageKey: "PLATFORM_APPROVED", currentLevel: "Sun NXT", ownerName: "Solo Employee", nextAction: "Confirm ready for development",
      wasRejected: false, approvedPlatform: expect.objectContaining({ name: "Sun NXT" }), readyToGo: false });
    expect(d.status.executiveDecision).toMatchObject({ approvalType: "CEO", by: "CEO" });
  });
});

describe("executive approval mode ALL (both CEO and COO)", () => {
  it("first approval is recorded but the pitch waits for the other executive", async () => {
    await db.update(systemSettings).set({ value: "ALL" }).where(eq(systemSettings.key, "executive_approval_mode"));
    try {
      const p = await makePitch(db, team.employeeA, { title: "Needs Both" });
      let v = p.version;
      const s = async (u: TestUser, b: Record<string, unknown>) => { const r = await performAction(db, u.actor, p.id, { expectedVersion: v, ...b }); v = r.version; return r; };
      await s(team.employeeA, { action: "ASSIGN", recipientId: team.employeeA.id });
      await s(team.employeeA, { action: "FORWARD", toStageKey: "EXECUTIVE_REVIEW", recipientId: team.ceo.id, remarks: "up" });
      const first = await s(team.ceo, { action: "SEND_TO_PLATFORM", recipientId: team.senior.id, remarks: "CEO yes" });
      expect(first.event).toMatchObject({ toStageKey: "EXECUTIVE_REVIEW", metadata: { partialApproval: true, awaiting: "COO" } });
      expect(await code(s(team.ceo, { action: "SEND_TO_PLATFORM", recipientId: team.senior.id, remarks: "again" }))).toBe("OK");
      const [again] = await db.select().from(workflowEvents).where(eq(workflowEvents.pitchId, p.id)).orderBy(workflowEvents.seq).then((r) => r.slice(-1));
      expect(again!.toStageKey).toBe("EXECUTIVE_REVIEW"); // the same person approving twice does not count as two
      const second = await s(team.coo, { action: "SEND_TO_PLATFORM", recipientId: team.senior.id, remarks: "COO yes" });
      expect(second.event.toStageKey).toBe("APPROVED_FOR_PLATFORM");
    } finally {
      await db.update(systemSettings).set({ value: "ANY" }).where(eq(systemSettings.key, "executive_approval_mode"));
    }
  });
});
