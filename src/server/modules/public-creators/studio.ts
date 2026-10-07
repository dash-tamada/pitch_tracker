/**
 * What the Creator Studio dashboard and the Production Houses tab show: the writer's pitches, where each has been sent, and
 * which production houses are accepting pitches. Every query is pinned to the signed-in writer.
 */
import { and, asc, count, desc, eq, sql } from "drizzle-orm";
import type { Db } from "@/server/db/client";
import { creatorDb } from "@/server/db/client";
import { companies, pitches, publicDraftSends, publicDrafts } from "@/server/db/schema";
import { companyCreatorId } from "./send";

/** The writer's pitches with how many production houses each has been sent to. */
export async function listMyPitches(db: Db, creatorId: string) {
  const drafts = await db.select({ id: publicDrafts.id, title: publicDrafts.title, logline: publicDrafts.logline, updatedAt: publicDrafts.updatedAt })
    .from(publicDrafts).where(eq(publicDrafts.creatorId, creatorId)).orderBy(desc(publicDrafts.updatedAt));
  const sent = await db.select({ draftId: publicDraftSends.draftId, n: count() }).from(publicDraftSends)
    .where(eq(publicDraftSends.creatorId, creatorId)).groupBy(publicDraftSends.draftId);
  const byDraft = new Map(sent.map((s) => [s.draftId, Number(s.n)]));
  return drafts.map((d) => ({ ...d, sentTo: byDraft.get(d.id) ?? 0 }));
}

export async function studioStats(db: Db, creatorId: string) {
  const [pitches] = await db.select({ n: count() }).from(publicDrafts).where(eq(publicDrafts.creatorId, creatorId));
  const [sends] = await db.select({ n: count(), houses: sql<number>`count(distinct ${publicDraftSends.companyId})::int` }).from(publicDraftSends).where(eq(publicDraftSends.creatorId, creatorId));
  return { pitches: Number(pitches?.n ?? 0), sends: Number(sends?.n ?? 0), houses: Number(sends?.houses ?? 0) };
}

/** Every send of this writer's pitches, newest first, with the production house's name. */
export async function listMySends(db: Db, creatorId: string) {
  return db.select({
    id: publicDraftSends.id, draftId: publicDraftSends.draftId, companyId: publicDraftSends.companyId,
    companyPitchId: publicDraftSends.companyPitchId, sentAt: publicDraftSends.sentAt,
    title: publicDrafts.title, company: companies.name,
  }).from(publicDraftSends)
    .innerJoin(publicDrafts, eq(publicDrafts.id, publicDraftSends.draftId))
    .innerJoin(companies, eq(companies.id, publicDraftSends.companyId))
    .where(eq(publicDraftSends.creatorId, creatorId)).orderBy(desc(publicDraftSends.sentAt));
}

/** Production houses that are accepting pitches right now. Names only: nothing else about a company is shown to writers. */
export async function listAcceptingHouses(db: Db) {
  return db.select({ id: companies.id, name: companies.name }).from(companies)
    .where(and(eq(companies.status, "ACTIVE"), eq(companies.acceptsCreatorSubmissions, true))).orderBy(asc(companies.name));
}

/** Which of these houses has this pitch already gone to (so the picker can hide them). */
export async function housesPitchWentTo(db: Db, creatorId: string, draftId: string): Promise<string[]> {
  const rows = await db.select({ c: publicDraftSends.companyId }).from(publicDraftSends)
    .where(and(eq(publicDraftSends.creatorId, creatorId), eq(publicDraftSends.draftId, draftId)));
  return rows.map((r) => r.c);
}

/** What a writer sees of a pitch's progress: friendly words for the company's internal workflow stages. */
const STAGE_LABEL: Record<string, string> = {
  SUBMITTED: "Received", INITIAL_REVIEW: "Under review", INTERNAL_REVIEW: "Under review", SENIOR_REVIEW: "Under review",
  CHANGES_REQUESTED: "Changes requested", ON_HOLD: "On hold", REJECTED: "Not taken forward",
  APPROVED_FOR_PLATFORM: "Moving ahead", PLATFORM_PITCHING: "Moving ahead", PLATFORM_APPROVED: "Moving ahead",
  READY_FOR_DEVELOPMENT: "In development", DEVELOPMENT: "In development", GREENLIT: "Greenlit",
  PRE_PRODUCTION: "In production", PRODUCTION: "In production", POST_PRODUCTION: "In production", COMPLETED: "Completed", RELEASED: "Completed",
};
export const stageLabel = (key: string) => STAGE_LABEL[key] ?? key.replace(/_/g, " ").toLowerCase().replace(/^./, (c) => c.toUpperCase());

export interface HousePitch { sendId: string; draftId: string; title: string; sentAt: Date; status: string | null; updatedAt: Date | null; history: { status: string; at: Date }[] }

/** The pitches this writer sent to one production house, with the status and the stage changes the house has made. */
export async function housePitches(db: Db, creatorId: string, companyId: string): Promise<HousePitch[]> {
  const sends = await db.select({ id: publicDraftSends.id, draftId: publicDraftSends.draftId, pitchId: publicDraftSends.companyPitchId, sentAt: publicDraftSends.sentAt, title: publicDrafts.title })
    .from(publicDraftSends).innerJoin(publicDrafts, eq(publicDrafts.id, publicDraftSends.draftId))
    .where(and(eq(publicDraftSends.creatorId, creatorId), eq(publicDraftSends.companyId, companyId))).orderBy(desc(publicDraftSends.sentAt));
  if (!sends.length) return [];
  const cdb = creatorDb(companyId, companyCreatorId(companyId, creatorId));
  return Promise.all(sends.map(async (s) => {
    try {
      const [p] = await cdb.select({ stage: pitches.currentStageKey, at: pitches.stageEnteredAt }).from(pitches).where(eq(pitches.id, s.pitchId));
      const h = await cdb.execute(sql`SELECT to_stage_key, happened_at FROM public.creator_portal_pitch_history(${s.pitchId})`);
      const history = (h.rows as { to_stage_key: string; happened_at: Date | string }[]).map((r) => ({ status: stageLabel(r.to_stage_key), at: new Date(r.happened_at) }));
      return { sendId: s.id, draftId: s.draftId, title: s.title, sentAt: s.sentAt, status: p ? stageLabel(p.stage) : null, updatedAt: p?.at ?? null, history };
    } catch {
      return { sendId: s.id, draftId: s.draftId, title: s.title, sentAt: s.sentAt, status: null, updatedAt: null, history: [] };
    }
  }));
}
