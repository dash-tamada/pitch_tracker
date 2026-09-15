import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  addPlatformContact, completeFollowUp, createPlatform, dueFollowUps, getPlatform, listPlatforms, pitchPlatformPitches, recordPlatformPitch,
  recordPlatformResponse, updatePlatform,
} from "@/server/modules/platforms/service";
import { advanceProduction, developmentPipeline, greenlight, pitchDevelopmentAndProduction, productionPipeline, startDevelopment } from "@/server/modules/production/service";
import { performAction } from "@/server/modules/workflow/engine";
import { closeDb, makePitch, makeTeam, platformId, testDb } from "../helpers/db";

const db = testDb();
let team: Awaited<ReturnType<typeof makeTeam>>;
const code = async (p: Promise<unknown>) => { try { await p; return "OK"; } catch (e) { return (e as { code?: string }).code ?? String(e); } };

async function approvedPitch(title: string) {
  const p = await makePitch(db, team.employeeA, { title });
  let v = p.version;
  const step = async (u: typeof team.employeeA, b: Record<string, unknown>) => { v = (await performAction(db, u.actor, p.id, { expectedVersion: v, ...b })).version; };
  await step(team.employeeA, { action: "ASSIGN", recipientId: team.employeeA.id });
  await step(team.employeeA, { action: "FORWARD", toStageKey: "EXECUTIVE_REVIEW", recipientId: team.coo.id, remarks: "up" });
  return { id: p.id, v, approve: async () => { await step(team.coo, { action: "SEND_TO_PLATFORM", recipientId: team.employeeC.id, remarks: "go" }); return v; } };
}

beforeAll(async () => { team = await makeTeam(db); });
afterAll(closeDb);

describe("platform database (Admin-managed, not hard-coded)", () => {
  it("admin adds, edits, disables platforms and contacts; employees cannot", async () => {
    const p = await createPlatform(db, team.admin.actor, { name: "Test OTT One", languageKeys: ["TELUGU"], genreKeys: ["THRILLER"] });
    expect(await code(createPlatform(db, team.admin.actor, { name: "test ott one" }))).toBe("CONFLICT");
    expect(await code(createPlatform(db, team.employeeA.actor, { name: "Nope" }))).toBe("FORBIDDEN");
    await addPlatformContact(db, team.admin.actor, p.id, { fullName: "Asha Rao", designation: "Content Acquisition", email: "Asha@Example.test", mobile: "9876500000" });
    const viewer = await getPlatform(db, team.viewer.actor, p.id);
    expect(viewer.contacts[0]).toMatchObject({ fullName: "Asha Rao", email: "a***@example.test", mobileE164: "+91 XXXXX 00000" });
    const pitcher = await getPlatform(db, team.employeeA.actor, p.id);
    expect(pitcher.contacts[0]).toMatchObject({ email: "asha@example.test", mobileE164: "+919876500000" });
    await updatePlatform(db, team.admin.actor, p.id, { active: false });
    expect((await listPlatforms(db, team.employeeA.actor)).some((x) => x.id === p.id)).toBe(false);
    expect(await code(getPlatform(db, team.employeeA.actor, p.id))).toBe("NOT_FOUND");
  });
});

describe("platform pitching rules", () => {
  it("cannot pitch to a platform before CEO/COO approval (business rule 8)", async () => {
    const p = await approvedPitch("Not yet approved");
    expect(await code(recordPlatformPitch(db, team.employeeA.actor, p.id, { expectedVersion: p.v, platformId: await platformId(db, "aha"), pitchDate: "2026-09-01" })))
      .toBe("TRANSITION_NOT_ALLOWED");
  });

  it("validates contact, dates and document versions belong to the right platform/pitch", async () => {
    const p = await approvedPitch("Validation");
    const v = await p.approve();
    const aha = await platformId(db, "aha");
    const other = await createPlatform(db, team.admin.actor, { name: "Contact Owner OTT" });
    const c = await addPlatformContact(db, team.admin.actor, other.id, { fullName: "Wrong Platform Contact" });
    expect(await code(recordPlatformPitch(db, team.employeeC.actor, p.id, { expectedVersion: v, platformId: aha, contactId: c.id, pitchDate: "2026-09-01" }))).toBe("VALIDATION");
    expect(await code(recordPlatformPitch(db, team.employeeC.actor, p.id, { expectedVersion: v, platformId: aha, pitchDate: "2099-01-01" }))).toBe("VALIDATION");
    expect(await code(recordPlatformPitch(db, team.employeeC.actor, p.id, { expectedVersion: v, platformId: aha, pitchDate: "2026-09-01", scriptVersionId: "00000000-0000-4000-8000-000000000000" }))).toBe("VALIDATION");
    expect(await code(recordPlatformPitch(db, team.outsider.actor, p.id, { expectedVersion: v, platformId: aha, pitchDate: "2026-09-01" }))).toBe("NOT_FOUND");
  });

  it("parallel platforms, rounds, append-only responses, follow-ups due today, and rejection does not change pitch stage", async () => {
    const p = await approvedPitch("Parallel");
    let v = await p.approve();
    const aha = await platformId(db, "aha"), zee = await platformId(db, "ZEE5");
    const a = await recordPlatformPitch(db, team.employeeC.actor, p.id, { expectedVersion: v, platformId: aha, pitchDate: "2026-09-01", followUpOn: "2026-09-08" });
    v = a.version;
    const z = await recordPlatformPitch(db, team.employeeC.actor, p.id, { expectedVersion: v, platformId: zee, pitchDate: "2026-09-02" });
    v = z.version;
    expect(await code(recordPlatformResponse(db, team.employeeC.actor, a.platformPitchId, { status: "INTERESTED", responseDate: "2026-08-01" }))).toBe("VALIDATION");
    await recordPlatformResponse(db, team.employeeC.actor, a.platformPitchId, { status: "REJECTED", responseDate: "2026-09-05", notes: "Not for our slate" });
    const due = await dueFollowUps(db, team.employeeC.actor, new Date("2026-09-10T06:00:00Z"));
    expect(due.find((d) => d.title === "Parallel")).toMatchObject({ platformName: "aha", overdue: true });
    await completeFollowUp(db, team.employeeC.actor, due.find((d) => d.title === "Parallel")!.id, { outcome: "They passed" });
    expect(await code(completeFollowUp(db, team.employeeC.actor, due.find((d) => d.title === "Parallel")!.id, { outcome: "again" }))).toBe("CONFLICT");
    // second round with aha after rework
    const a2 = await recordPlatformPitch(db, team.employeeC.actor, p.id, { expectedVersion: v, platformId: aha, pitchDate: "2026-09-12" });
    const list = await pitchPlatformPitches(db, team.employeeC.actor, p.id);
    expect(list.map((x) => [x.platformName, x.roundNo, x.currentStatus])).toEqual([["aha", 2, "PITCHED"], ["ZEE5", 1, "PITCHED"], ["aha", 1, "REJECTED"]]);
    expect(list[2]!.responses.map((r) => r.status)).toEqual(["PITCHED", "REJECTED"]);
    // ZEE5 approves → pitch becomes Platform Approved, naming ZEE5
    const appr = await recordPlatformResponse(db, team.employeeC.actor, z.platformPitchId, { status: "APPROVED", responseDate: "2026-09-13", expectedVersion: a2.version });
    expect(appr.version).toBeGreaterThan(a2.version);
    // a later approval from another platform is recorded without moving the pitch again
    const again = await recordPlatformResponse(db, team.employeeC.actor, a2.platformPitchId, { status: "APPROVED", responseDate: "2026-09-14" });
    expect(again.version).toBeUndefined();
  });
});

describe("development & production", () => {
  it("runs dev → greenlight → production with owners, append-only updates, budget visible to management only", async () => {
    const p = await approvedPitch("Production Path");
    let v = await p.approve();
    const netflix = await platformId(db, "Netflix");
    const pp = await recordPlatformPitch(db, team.employeeC.actor, p.id, { expectedVersion: v, platformId: netflix, pitchDate: "2026-09-01" });
    v = (await recordPlatformResponse(db, team.employeeC.actor, pp.platformPitchId, { status: "APPROVED", responseDate: "2026-09-03", expectedVersion: pp.version })).version!;
    expect(await code(startDevelopment(db, team.senior.actor, p.id, { expectedVersion: v, ownerId: team.senior.id }))).toBe("TRANSITION_NOT_ALLOWED"); // must be marked ready first
    v = (await performAction(db, team.senior.actor, p.id, { action: "MARK_READY_FOR_DEVELOPMENT", expectedVersion: v })).version;
    expect((await developmentPipeline(db, team.senior.actor)).ready.some((r) => r.id === p.id)).toBe(true);
    expect(await code(startDevelopment(db, team.employeeC.actor, p.id, { expectedVersion: v, ownerId: team.senior.id }))).toBe("FORBIDDEN");
    v = (await startDevelopment(db, team.senior.actor, p.id, { expectedVersion: v, ownerId: team.senior.id, startDate: "2026-09-04", expectedCompletion: "2026-12-01" })).version;
    expect(await code(greenlight(db, team.senior.actor, p.id, { expectedVersion: v, productionOwnerId: team.senior.id, remarks: "x" }))).toBe("FORBIDDEN"); // CEO/COO only
    v = (await greenlight(db, team.ceo.actor, p.id, { expectedVersion: v, productionOwnerId: team.senior.id, remarks: "Go", budgetRupees: 12_500_000, productionCompany: "Tamada Studios" })).version;
    for (let i = 0; i < 4; i++) v = (await advanceProduction(db, team.senior.actor, p.id, { expectedVersion: v })).version;
    expect(await code(advanceProduction(db, team.senior.actor, p.id, { expectedVersion: v }))).toBe("VALIDATION"); // release date required
    v = (await advanceProduction(db, team.senior.actor, p.id, { expectedVersion: v, actualRelease: "2026-09-15" })).version;
    const mgmt = await pitchDevelopmentAndProduction(db, team.ceo.actor, p.id);
    expect(mgmt.production).toMatchObject({ status: "RELEASED", budgetRupees: 12_500_000, platformName: "Netflix", productionCompany: "Tamada Studios" });
    expect(mgmt.development).toMatchObject({ status: "DEVELOPMENT_COMPLETED" });
    expect(mgmt.production!.updates.map((u) => u.status)).toEqual(["GREENLIT", "PRE_PRODUCTION", "PRODUCTION", "POST_PRODUCTION", "COMPLETED", "RELEASED"]);
    const emp = await pitchDevelopmentAndProduction(db, team.employeeC.actor, p.id);
    expect(emp.production!.budgetRupees).toBeNull();
    expect((await productionPipeline(db, team.senior.actor)).find((r) => r.id === p.id)!.budgetRupees).toBe(12_500_000);
  });
});
