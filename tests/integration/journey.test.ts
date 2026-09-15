/**
 * End-to-end journey through the real engine and PostgreSQL (brief §69):
 * Submitted → Employee A → B → C → COO → Approved for Platform → Netflix → Netflix Approved
 * → Ready for Development → Development → Greenlit → Pre-Production → Production → … → Released
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asc, eq } from "drizzle-orm";
import { pitches, ratings, workflowEvents, notifications, auditLogs, platformResponses, platformPitches, productionProjects, developmentProjects } from "@/server/db/schema";
import { recordPlatformPitch, recordPlatformResponse } from "@/server/modules/platforms/service";
import { advanceProduction, greenlight, startDevelopment } from "@/server/modules/production/service";
import { getAvailableActions, loadStages, performAction, getTimeline } from "@/server/modules/workflow/engine";
import { foldEvents } from "@/server/modules/workflow/rules";
import { closeDb, makePitch, makeTeam, platformId, testDb, type TestUser } from "../helpers/db";

const db = testDb();
let team: Awaited<ReturnType<typeof makeTeam>>;
let pitchId = "";
let version = 1;

async function act(user: TestUser, body: Record<string, unknown>) {
  const res = await performAction(db, user.actor, pitchId, { expectedVersion: version, ...body });
  version = res.version;
  return res.event;
}

beforeAll(async () => {
  team = await makeTeam(db);
  const p = await makePitch(db, team.employeeA);
  pitchId = p.id;
  version = p.version;
});
afterAll(closeDb);

describe("The Last Journey — full pipeline", () => {
  it("runs every stage with the right people", async () => {
    const netflix = await platformId(db, "Netflix");
    await act(team.employeeA, { action: "ASSIGN", recipientId: team.employeeA.id });
    await act(team.employeeA, { action: "ACCEPT", recipientId: team.employeeB.id, remarks: "Strong concept. Recommend forwarding to Employee B.",
      rating: { overall: 4, scores: [{ categoryKey: "ORIGINALITY", score: 5 }], comments: "Fresh setting" } });
    await act(team.employeeB, { action: "REQUEST_CHANGES", remarks: "Tighten episode 3", changeTypeKeys: ["SCRIPT"] });
    await act(team.employeeB, { action: "RESUME", remarks: "Script V2 received" });
    await act(team.employeeB, { action: "FORWARD", toStageKey: "INTERNAL_REVIEW", recipientId: team.employeeC.id, remarks: "Over to C" });
    await act(team.employeeC, { action: "FORWARD", toStageKey: "EXECUTIVE_REVIEW", recipientId: team.coo.id, remarks: "Ready for COO" });
    await act(team.coo, { action: "SEND_TO_PLATFORM", recipientId: team.senior.id, remarks: "Pitch to Netflix first", recommendedPlatformIds: [netflix] });
    const pp = await recordPlatformPitch(db, team.senior.actor, pitchId, { expectedVersion: version, platformId: netflix, pitchDate: "2026-09-10",
      methodKey: "EMAIL", materialsSent: ["Pitch deck", "Script V2"], remarks: "Deck + Script V2 sent", followUpOn: "2026-09-17" });
    version = pp.version;
    await recordPlatformResponse(db, team.senior.actor, pp.platformPitchId, { status: "INTERESTED", responseDate: "2026-09-12" });
    await recordPlatformResponse(db, team.senior.actor, pp.platformPitchId, { status: "SECOND_DRAFT_REQUESTED", responseDate: "2026-09-13", notes: "Tighten episode 3" });
    const appr = await recordPlatformResponse(db, team.senior.actor, pp.platformPitchId, { status: "APPROVED", responseDate: "2026-09-14", notes: "Netflix approved second draft", expectedVersion: version });
    version = appr.version!;
    await act(team.coo, { action: "MARK_READY_FOR_DEVELOPMENT" });
    version = (await startDevelopment(db, team.coo.actor, pitchId, { expectedVersion: version, ownerId: team.senior.id, startDate: "2026-09-15" })).version;
    version = (await greenlight(db, team.ceo.actor, pitchId, { expectedVersion: version, productionOwnerId: team.senior.id, remarks: "Greenlit with Netflix", budgetRupees: 45_000_000 })).version;
    for (let i = 0; i < 4; i++) version = (await advanceProduction(db, team.senior.actor, pitchId, { expectedVersion: version })).version;
    version = (await advanceProduction(db, team.senior.actor, pitchId, { expectedVersion: version, actualRelease: "2026-09-15" })).version;

    // platform response history is preserved, never overwritten
    const history = await db.select({ status: platformResponses.status }).from(platformResponses).where(eq(platformResponses.platformPitchId, pp.platformPitchId)).orderBy(platformResponses.createdAt);
    expect(history.map((h) => h.status)).toEqual(["PITCHED", "INTERESTED", "SECOND_DRAFT_REQUESTED", "APPROVED"]);
    const [ppRow] = await db.select().from(platformPitches).where(eq(platformPitches.id, pp.platformPitchId));
    expect(ppRow!.currentStatus).toBe("APPROVED");
    const [dev] = await db.select().from(developmentProjects).where(eq(developmentProjects.pitchId, pitchId));
    expect(dev).toMatchObject({ status: "DEVELOPMENT_COMPLETED", platformPitchId: pp.platformPitchId });
    const [prod] = await db.select().from(productionProjects).where(eq(productionProjects.pitchId, pitchId));
    expect(prod).toMatchObject({ status: "RELEASED", platformId: netflix, actualRelease: "2026-09-15", budgetPaise: 4_500_000_000n });
    const [p] = await db.select().from(pitches).where(eq(pitches.id, pitchId));
    expect(p!.currentStageKey).toBe("RELEASED");
    expect(p!.currentOwnerId).toBe(team.senior.id);
  });

  it("timeline records who, what and when for every step, in order", async () => {
    const events = await getTimeline(db, team.ceo.actor, pitchId);
    expect(events.map((e) => e.action)).toEqual([
      "SUBMIT", "ASSIGN", "ACCEPT", "REQUEST_CHANGES", "RESUME", "FORWARD", "FORWARD", "SEND_TO_PLATFORM",
      "RECORD_PLATFORM_PITCH", "MARK_PLATFORM_APPROVED", "MARK_READY_FOR_DEVELOPMENT", "START_DEVELOPMENT", "GREENLIGHT",
      "ADVANCE", "ADVANCE", "ADVANCE", "ADVANCE", "ADVANCE",
    ]);
    expect(events.map((e) => e.seq)).toEqual(events.map((_, i) => i + 1));
    const send = events.find((e) => e.action === "SEND_TO_PLATFORM")!;
    expect(send).toMatchObject({ actorId: team.coo.id, approvalType: "COO", fromStageKey: "EXECUTIVE_REVIEW", toStageKey: "APPROVED_FOR_PLATFORM" });
    const approved = events.find((e) => e.action === "MARK_PLATFORM_APPROVED")!;
    expect(approved.platformId).toBe(await platformId(db, "Netflix"));
    const fwd = events.find((e) => e.action === "FORWARD" && e.toStageKey === "EXECUTIVE_REVIEW")!;
    expect(fwd).toMatchObject({ fromOwnerId: team.employeeC.id, toOwnerId: team.coo.id, remarks: "Ready for COO" });
  });

  it("projection equals a fold of the event log (rule 20)", async () => {
    const [p] = await db.select().from(pitches).where(eq(pitches.id, pitchId));
    const events = await db.select().from(workflowEvents).where(eq(workflowEvents.pitchId, pitchId)).orderBy(asc(workflowEvents.seq));
    const folded = foldEvents(events, await loadStages(db, p!.workflowDefinitionId));
    expect(folded).toEqual({ currentStageKey: p!.currentStageKey, currentOwnerId: p!.currentOwnerId,
      stageEnteredAt: p!.stageEnteredAt, pausedFromStageKey: p!.pausedFromStageKey, lastEventSeq: p!.lastEventSeq });
  });

  it("stores ratings as separate records tied to the review event", async () => {
    const rs = await db.select().from(ratings).where(eq(ratings.pitchId, pitchId));
    expect(rs).toHaveLength(1);
    expect(rs[0]).toMatchObject({ reviewerId: team.employeeA.id, overall: 4 });
    expect(rs[0]!.workflowEventId).not.toBeNull();
  });

  it("notified each recipient and audited each action", async () => {
    const n = await db.select().from(notifications).where(eq(notifications.pitchId, pitchId));
    expect(new Set(n.map((x) => x.userId))).toEqual(new Set([team.employeeB.id, team.employeeC.id, team.coo.id, team.senior.id, team.employeeA.id])); // A submitted it: told about approval + greenlight
    for (const x of n) expect(x.title).not.toMatch(/synopsis|script text/i);
    const audits = await db.select().from(auditLogs).where(eq(auditLogs.resourceId, pitchId));
    expect(audits.filter((a) => a.action.startsWith("workflow.")).length).toBe(17);
    expect(audits.map((a) => a.action)).toEqual(expect.arrayContaining(["pitch.created", "platform.pitch_recorded", "platform.response_recorded", "development.started", "production.greenlit", "production.status_changed"]));
  });

  it("released pitch offers no further actions", async () => {
    expect(await getAvailableActions(db, team.ceo.actor, pitchId)).toHaveLength(0);
  });
});
