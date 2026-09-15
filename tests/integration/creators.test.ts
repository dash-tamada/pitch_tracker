import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  addCreatorProject, createCreator, creatorStats, findCreatorMatches, getCreatorProfile, listCreators, setCreatorArchived, updateCreator,
} from "@/server/modules/creators/service";
import { addPitchRating, creatorRatings } from "@/server/modules/ratings/service";
import { createPitch } from "@/server/modules/pitches/service";
import { performAction } from "@/server/modules/workflow/engine";
import { recordPlatformPitch, recordPlatformResponse } from "@/server/modules/platforms/service";
import { closeDb, makeTeam, platformId, testDb } from "../helpers/db";

const db = testDb();
let team: Awaited<ReturnType<typeof makeTeam>>;
const code = async (p: Promise<unknown>) => { try { await p; return "OK"; } catch (e) { return (e as { code?: string }).code ?? String(e); } };
let creatorId = "";

beforeAll(async () => {
  team = await makeTeam(db);
  const c = await createCreator(db, team.employeeA.actor, {
    creatorType: "WRITER_DIRECTOR", fullName: "Ravi Kumar Stats", mobile: "9000011111", email: "ravi.stats@example.test",
    languageKeys: ["TELUGU", "HINDI"], previousCompanies: ["Sunrise Pictures"],
    projects: [{ projectName: "Kaalam", role: "DIRECTOR", releaseYear: 2023, platformName: "aha", externalLinks: [{ label: "Trailer", url: "https://example.test/t" }] }],
  });
  creatorId = c.id;
});
afterAll(closeDb);

describe("creator onboarding & dedupe", () => {
  it("stores first-time onboarding projects with the profile", async () => {
    const p = await getCreatorProfile(db, team.senior.actor, creatorId);
    expect(p.projects).toHaveLength(1);
    expect(p.projects[0]).toMatchObject({ projectName: "Kaalam", role: "DIRECTOR", releaseYear: 2023 });
  });
  it("finds the existing profile by mobile in another format, by email, and by partial name", async () => {
    expect((await findCreatorMatches(db, team.employeeB.actor, { mobile: "+91 90000 11111" }))[0]).toMatchObject({ id: creatorId, matchedOn: ["mobile"] });
    expect((await findCreatorMatches(db, team.employeeB.actor, { email: "RAVI.STATS@example.test" }))[0]?.id).toBe(creatorId);
    expect((await findCreatorMatches(db, team.employeeB.actor, { name: "ravi kumar" })).map((m) => m.id)).toContain(creatorId);
  });
  it("partial update keeps fields that were not sent (no silent wipe of languages)", async () => {
    await updateCreator(db, team.senior.actor, creatorId, { bio: "Telugu thriller specialist" });
    const p = await getCreatorProfile(db, team.senior.actor, creatorId);
    expect(p.creator.languageKeys).toEqual(["TELUGU", "HINDI"]);
    expect(p.creator.previousCompanies).toEqual(["Sunrise Pictures"]);
    expect(p.creator.bio).toBe("Telugu thriller specialist");
  });
  it("employees cannot edit or archive creators; updates to a duplicate mobile are refused", async () => {
    expect(await code(updateCreator(db, team.employeeA.actor, creatorId, { bio: "x" }))).toBe("FORBIDDEN");
    expect(await code(setCreatorArchived(db, team.senior.actor, creatorId, true))).toBe("FORBIDDEN");
    const other = await createCreator(db, team.senior.actor, { creatorType: "WRITER", fullName: "Other Writer", mobile: "9000022222" });
    expect(await code(updateCreator(db, team.senior.actor, other.id, { mobile: "9000011111" }))).toBe("CONFLICT");
    expect(await code(addCreatorProject(db, team.employeeA.actor, creatorId, { projectName: "X", role: "WRITER" }))).toBe("FORBIDDEN");
  });
  it("list masks PII for employees and paginates without duplicates", async () => {
    for (let i = 0; i < 5; i++) await createCreator(db, team.senior.actor, { creatorType: "DIRECTOR", fullName: `Paging Director ${i}` });
    const seen = new Set<string>();
    let cursor: string | undefined;
    do {
      const page = await listCreators(db, team.employeeA.actor, { q: "paging director", limit: 2, cursor });
      for (const c of page.items) { expect(seen.has(c.id)).toBe(false); seen.add(c.id); }
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    expect(seen.size).toBe(5);
    const [ravi] = (await listCreators(db, team.employeeA.actor, { q: "ravi kumar stats" })).items;
    expect(ravi!.mobile).toBe("+91 XXXXX 11111");
    expect(ravi!.notes).toBeNull();
  });
  it("rejects invalid cursor and unknown filter keys", async () => {
    expect(await code(listCreators(db, team.employeeA.actor, { cursor: "garbage" }))).toBe("VALIDATION");
    expect(await code(listCreators(db, team.employeeA.actor, { orderBy: "mobile_e164" }))).toBe("VALIDATION");
  });
});

describe("creator statistics come from real workflow records", () => {
  it("counts reached stages and platform outcomes, only for pitches the viewer can see", async () => {
    const netflix = await platformId(db, "Netflix");
    const mk = (title: string) => createPitch(db, team.employeeA.actor, { title, formatKey: "WEB_SERIES", languageKey: "TELUGU", creatorId });
    // pitch 1: approved and platform-approved
    const p1 = await mk("Stats One"); let v = p1.version;
    const s1 = async (u: typeof team.employeeA, b: Record<string, unknown>) => { v = (await performAction(db, u.actor, p1.id, { expectedVersion: v, ...b })).version; };
    await s1(team.employeeA, { action: "ASSIGN", recipientId: team.employeeA.id });
    await s1(team.employeeA, { action: "FORWARD", toStageKey: "EXECUTIVE_REVIEW", recipientId: team.ceo.id, remarks: "up" });
    await s1(team.ceo, { action: "SEND_TO_PLATFORM", recipientId: team.senior.id, remarks: "go" });
    const pp = await recordPlatformPitch(db, team.senior.actor, p1.id, { expectedVersion: v, platformId: netflix, pitchDate: "2026-09-01" });
    await recordPlatformResponse(db, team.senior.actor, pp.platformPitchId, { status: "APPROVED", responseDate: "2026-09-02", expectedVersion: pp.version, notes: "yes" });
    // pitch 2: rejected
    const p2 = await mk("Stats Two"); let v2 = p2.version;
    v2 = (await performAction(db, team.employeeA.actor, p2.id, { expectedVersion: v2, action: "ASSIGN", recipientId: team.employeeA.id })).version;
    await performAction(db, team.employeeA.actor, p2.id, { expectedVersion: v2, action: "REJECT", rejectionCategoryKey: "WEAK_STORY", rejectionReason: "Premise does not hold up." });
    // pitch 3: still under review
    await mk("Stats Three");

    const s = await creatorStats(db, team.ceo.actor, creatorId);
    expect(s).toMatchObject({ total: 3, rejected: 1, underReview: 1, forwarded: 1, approved: 1, sentToPlatforms: 1, platformApproved: 1, production: 0 });
    expect(s.rates).toEqual({ approvalRate: 33.3, platformApprovalRate: 100, productionRate: 0 });

    // an uninvolved employee sees none of these pitches, so the numbers must not leak them
    const outsider = await creatorStats(db, team.outsider.actor, creatorId);
    expect(outsider.total).toBe(0);
  });
});

describe("ratings", () => {
  it("are separate historical records; averages and categories are computed; visibility is enforced", async () => {
    const p = await createPitch(db, team.employeeA.actor, { title: "Rated", formatKey: "FEATURE_FILM", languageKey: "TELUGU", creatorId });
    await addPitchRating(db, team.employeeA.actor, p.id, { overall: 4, scores: [{ categoryKey: "ORIGINALITY", score: 5 }] });
    await addPitchRating(db, team.employeeA.actor, p.id, { overall: 3, scores: [{ categoryKey: "ORIGINALITY", score: 3 }], comments: "Second look" });
    const r = await creatorRatings(db, team.ceo.actor, creatorId);
    expect(r.count).toBe(2);
    expect(r.average).toBe(3.5);
    expect(r.byCategory).toEqual([{ key: "ORIGINALITY", label: "Originality", average: 4, count: 2 }]);
    expect(r.history[0]!.reviewerId).toBe(team.employeeA.id);
    expect(await code(creatorRatings(db, team.employeeA.actor, creatorId))).toBe("FORBIDDEN"); // default: management only
    expect(await code(addPitchRating(db, team.outsider.actor, p.id, { overall: 1 }))).toBe("NOT_FOUND");
    expect(await code(addPitchRating(db, team.employeeA.actor, p.id, { overall: 6 }))).toBe("VALIDATION");
  });
});
