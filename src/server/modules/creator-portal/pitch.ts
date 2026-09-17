/**
 * Creator-facing pitch submission and status. Runs entirely on the pitch_creator role: the actual
 * INSERTs into pitches/workflow_events are made by pitch_creator itself (RLS-checked — see
 * creator_submit_pitch/creator_submit_event in drizzle/0007_creator_portal.sql), while the staff-only
 * bookkeeping neither table's RLS can reach (pitch numbering, plan limits) is delegated to
 * creator_portal_prepare_submission(), a narrow SECURITY DEFINER function — see its own comment there
 * for why that split exists and what it does and does not do.
 */
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { creatorDb, type Db } from "@/server/db/client";
import { lookupValues, pitches } from "@/server/db/schema";
import { AppError, notFound } from "@/server/lib/errors";
import { parseInput } from "@/server/lib/validation";
import { auditPortalAction } from "@/server/modules/creator-portal/auth";
import type { RequestContext } from "@/server/modules/audit/service";

// Formats that get an episode count in addition to a per-episode duration; every other format only ever
// collects a single "Duration" value, stored in the same episode_duration_min column (see HANDOFF.md: "No
// of episodes (If they selected Series or serial ask this) ... if not Show only Duration").
const EPISODIC_FORMATS = new Set(["WEB_SERIES", "TV_SERIES"]);

const opt = (max: number) => z.string().trim().max(max).optional().transform((v) => (v === "" ? undefined : v));
const key = z.string().trim().min(1).max(60);

export const submitPitchSchema = z.object({
  title: z.string().trim().min(1).max(200),
  logline: opt(500),
  shortSynopsis: opt(5000),
  detailedSynopsis: opt(100000),
  formatKey: key,
  languageKey: key,
  genreKey: key.optional(),
  episodeCount: z.number().int().min(1).max(1000).optional(),
  episodeDurationMin: z.number().int().min(1).max(600).optional(),
  targetAudience: opt(200),
  notes: opt(5000),
}).strict();

async function assertLookup(tx: Db, type: "FORMAT" | "LANGUAGE" | "GENRE", k: string | undefined) {
  if (!k) return;
  const [hit] = await tx.select({ key: lookupValues.key }).from(lookupValues)
    .where(sql`${lookupValues.type} = ${type} AND ${lookupValues.key} = ${k} AND ${lookupValues.active} = true`);
  if (!hit) throw new AppError("VALIDATION", "Unknown option selected.", { [type.toLowerCase()]: "Invalid" });
}

export interface SubmitPitchResult { pitchId: string; pitchCode: string }

/** The creator submitting IS the creator being pitched — pitches.creatorId is always this session's own id (never chosen). */
export async function submitCreatorPitch(companyId: string, creatorId: string, raw: unknown, ctx: RequestContext = {}): Promise<SubmitPitchResult> {
  const input = parseInput(submitPitchSchema, raw);
  const episodic = EPISODIC_FORMATS.has(input.formatKey);
  if (input.episodeCount !== undefined && !episodic) {
    throw new AppError("VALIDATION", "Episode count only applies to Series or Serial formats.", { episodeCount: "Not applicable" });
  }

  const db = creatorDb(companyId, creatorId);
  await assertLookup(db, "FORMAT", input.formatKey);
  await assertLookup(db, "LANGUAGE", input.languageKey);
  await assertLookup(db, "GENRE", input.genreKey);

  const prepared = await db.execute(sql`SELECT * FROM public.creator_portal_prepare_submission()`);
  const p = prepared.rows[0] as { pitch_code: string; workflow_definition_id: string; initial_stage_key: string } | undefined;
  if (!p) throw new AppError("INTERNAL", "Could not prepare this submission. Please try again.");

  const pitchId = randomUUID();
  await db.insert(pitches).values({
    id: pitchId, title: input.title, logline: input.logline ?? null, shortSynopsis: input.shortSynopsis ?? null,
    detailedSynopsis: input.detailedSynopsis ?? null, genreKey: input.genreKey ?? null, formatKey: input.formatKey, languageKey: input.languageKey,
    episodeCount: episodic ? input.episodeCount ?? null : null, episodeDurationMin: input.episodeDurationMin ?? null,
    targetAudience: input.targetAudience ?? null, notes: input.notes ?? null,
    creatorId, createdByCreatorId: creatorId, submittedViaPortal: true,
    pitchCode: p.pitch_code, workflowDefinitionId: p.workflow_definition_id, currentStageKey: p.initial_stage_key, lastEventSeq: 1,
  });
  // No .returning() on the event insert: pitch_creator has no SELECT grant on workflow_events at all (by
  // design — see §8 of the migration), so RETURNING there would fail exactly like the RLS/RETURNING trap
  // in creator-portal/auth.ts's registerCreator, just via a permission error instead of an RLS one.
  await db.execute(sql`INSERT INTO public.workflow_events
    (pitch_id, seq, action, from_stage_key, to_stage_key, actor_creator_id, remarks)
    VALUES (${pitchId}, 1, 'SUBMIT', NULL, ${p.initial_stage_key}, ${creatorId}, 'Submitted via creator portal')`);
  await auditPortalAction(db, "creator_portal.pitch_submitted", "pitch", pitchId, { pitchCode: p.pitch_code });
  return { pitchId, pitchCode: p.pitch_code };
}

/** Every pitch this creator has ever submitted — own rows only (creator_own_pitches RLS). */
export async function listMyPitches(companyId: string, creatorId: string) {
  const db = creatorDb(companyId, creatorId);
  return db.select({
    id: pitches.id, pitchCode: pitches.pitchCode, title: pitches.title, formatKey: pitches.formatKey, languageKey: pitches.languageKey,
    currentStageKey: pitches.currentStageKey, createdAt: pitches.createdAt,
  }).from(pitches).orderBy(sql`${pitches.createdAt} DESC`);
}

export async function getMyPitch(companyId: string, creatorId: string, pitchId: string) {
  const db = creatorDb(companyId, creatorId);
  const [row] = await db.select().from(pitches).where(sql`${pitches.id} = ${pitchId}`);
  // creator_own_pitches RLS already means a pitch belonging to someone else simply never appears in this
  // query's result set — this NOT_FOUND is what a stranger's pitch id and a made-up one both look like,
  // so there is no existence oracle.
  if (!row) throw notFound("Pitch");
  return row;
}
