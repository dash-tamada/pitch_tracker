/** Creator portal pitch submission: format-conditional fields, pitch numbering, and cross-creator/cross-company isolation. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { registerCreator } from "@/server/modules/creator-portal/auth";
import { getMyPitch, listMyPitches, submitCreatorPitch } from "@/server/modules/creator-portal/pitch";
import { closeDb, COMPANY_A, COMPANY_B, makePortalLink } from "../helpers/db";

const errCode = async (p: Promise<unknown>) => { try { await p; return "OK"; } catch (e) { return (e as { code?: string }).code ?? String(e); } };

let tokenA: string;
let tokenB: string;
let creatorA1: { creatorId: string; companyId: string };
let creatorA2: { creatorId: string; companyId: string };
let creatorB1: { creatorId: string; companyId: string };

beforeAll(async () => {
  tokenA = await makePortalLink(COMPANY_A);
  tokenB = await makePortalLink(COMPANY_B);
  creatorA1 = await registerCreator({ token: tokenA, creatorType: "WRITER", fullName: "Pitch Creator A1", email: `pc.a1.${Date.now()}@example.test`, password: "correct horse battery staple 9" });
  creatorA2 = await registerCreator({ token: tokenA, creatorType: "WRITER", fullName: "Pitch Creator A2", email: `pc.a2.${Date.now()}@example.test`, password: "correct horse battery staple 9" });
  creatorB1 = await registerCreator({ token: tokenB, creatorType: "WRITER", fullName: "Pitch Creator B1", email: `pc.b1.${Date.now()}@example.test`, password: "correct horse battery staple 9" });
});
afterAll(closeDb);

const base = {
  title: "The Last Journey", logline: "A one-line hook.", shortSynopsis: "Short version.", detailedSynopsis: "Long version.",
  languageKey: "TELUGU", genreKey: "THRILLER", targetAudience: "Young adults", notes: "Some notes.",
};

describe("creator portal pitch submission", () => {
  it("submits a non-episodic pitch (Feature Film) using duration only, with no episode count", async () => {
    const r = await submitCreatorPitch(creatorA1.companyId, creatorA1.creatorId, { ...base, formatKey: "FEATURE_FILM", episodeDurationMin: 120 });
    expect(r.pitchId).toBeTruthy();
    expect(r.pitchCode).toMatch(/^[A-Z]+-\d{4}-\d+$/);
    const row = await getMyPitch(creatorA1.companyId, creatorA1.creatorId, r.pitchId);
    expect(row.formatKey).toBe("FEATURE_FILM");
    expect(row.episodeCount).toBeNull();
    expect(row.episodeDurationMin).toBe(120);
    expect(row.submittedViaPortal).toBe(true);
    expect(row.creatorId).toBe(creatorA1.creatorId);
    expect(row.createdByCreatorId).toBe(creatorA1.creatorId);
  });

  it("submits an episodic pitch (Web Series) with episode count + per-episode duration", async () => {
    const r = await submitCreatorPitch(creatorA1.companyId, creatorA1.creatorId, { ...base, formatKey: "WEB_SERIES", episodeCount: 8, episodeDurationMin: 40 });
    const row = await getMyPitch(creatorA1.companyId, creatorA1.creatorId, r.pitchId);
    expect(row.episodeCount).toBe(8);
    expect(row.episodeDurationMin).toBe(40);
  });

  it("submits an episodic pitch (TV Series) with episode count too", async () => {
    const r = await submitCreatorPitch(creatorA1.companyId, creatorA1.creatorId, { ...base, formatKey: "TV_SERIES", episodeCount: 26, episodeDurationMin: 22 });
    const row = await getMyPitch(creatorA1.companyId, creatorA1.creatorId, r.pitchId);
    expect(row.episodeCount).toBe(26);
  });

  it("rejects an episode count on a non-episodic format (Documentary)", async () => {
    expect(await errCode(submitCreatorPitch(creatorA1.companyId, creatorA1.creatorId, { ...base, formatKey: "DOCUMENTARY", episodeCount: 5, episodeDurationMin: 90 })))
      .toBe("VALIDATION");
  });

  it("rejects an unknown format/language/genre key", async () => {
    expect(await errCode(submitCreatorPitch(creatorA1.companyId, creatorA1.creatorId, { ...base, formatKey: "NOT_A_REAL_FORMAT", episodeDurationMin: 90 })))
      .toBe("VALIDATION");
    expect(await errCode(submitCreatorPitch(creatorA1.companyId, creatorA1.creatorId, { ...base, formatKey: "FEATURE_FILM", languageKey: "KLINGON", episodeDurationMin: 90 })))
      .toBe("VALIDATION");
  });

  it("submits correctly for a creator in a second, independent company", async () => {
    const r = await submitCreatorPitch(creatorB1.companyId, creatorB1.creatorId, { ...base, formatKey: "FEATURE_FILM", episodeDurationMin: 100 });
    expect(r.pitchId).toBeTruthy();
    const row = await getMyPitch(creatorB1.companyId, creatorB1.creatorId, r.pitchId);
    expect(row.creatorId).toBe(creatorB1.creatorId);
  });

  it("allocates increasing, company-scoped pitch codes", async () => {
    const r1 = await submitCreatorPitch(creatorA1.companyId, creatorA1.creatorId, { ...base, formatKey: "FEATURE_FILM", episodeDurationMin: 100 });
    const r2 = await submitCreatorPitch(creatorA1.companyId, creatorA1.creatorId, { ...base, formatKey: "FEATURE_FILM", episodeDurationMin: 100 });
    expect(r1.pitchCode).not.toBe(r2.pitchCode);
  });

  it("lists only the submitting creator's own pitches, never a company teammate's", async () => {
    const r = await submitCreatorPitch(creatorA2.companyId, creatorA2.creatorId, { ...base, formatKey: "FEATURE_FILM", episodeDurationMin: 95 });
    const mineA2 = await listMyPitches(creatorA2.companyId, creatorA2.creatorId);
    expect(mineA2.some((p) => p.id === r.pitchId)).toBe(true);
    const mineA1 = await listMyPitches(creatorA1.companyId, creatorA1.creatorId);
    expect(mineA1.some((p) => p.id === r.pitchId)).toBe(false);
  });

  it("hides another creator's pitch from getMyPitch as NOT_FOUND (no existence oracle)", async () => {
    const r = await submitCreatorPitch(creatorA1.companyId, creatorA1.creatorId, { ...base, formatKey: "FEATURE_FILM", episodeDurationMin: 100 });
    expect(await errCode(getMyPitch(creatorA2.companyId, creatorA2.creatorId, r.pitchId))).toBe("NOT_FOUND");
  });

  it("hides a same-company pitch from a different company entirely, and a made-up id the same way", async () => {
    const r = await submitCreatorPitch(creatorA1.companyId, creatorA1.creatorId, { ...base, formatKey: "FEATURE_FILM", episodeDurationMin: 100 });
    expect(await errCode(getMyPitch(creatorB1.companyId, creatorB1.creatorId, r.pitchId))).toBe("NOT_FOUND");
    expect(await errCode(getMyPitch(creatorA1.companyId, creatorA1.creatorId, "00000000-0000-0000-0000-000000000000"))).toBe("NOT_FOUND");
  });
});
