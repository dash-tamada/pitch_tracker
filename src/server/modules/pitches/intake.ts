/**
 * "New pitch received": pitches that arrived from outside the company (a creator portal or the Creator Studio) and that no one
 * on staff has acknowledged yet. The acknowledgement is company-wide — the first person to click it clears it for everyone.
 */
import { desc, eq, inArray, isNull, and } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/server/db/client";
import { creators, pitchIntakeAcks, pitches } from "@/server/db/schema";
import { parseInput } from "@/server/lib/validation";
import { can, type Actor } from "@/server/modules/authz/policy";

/** Only people who triage incoming work are interrupted; everyone else is never shown a pitch they have no role in. */
export const canSeeIntake = (actor: Actor) => can(actor, "pitch.view_all") || can(actor, "pitch.accept") || can(actor, "pitch.approve_executive");

export async function unseenIntake(db: Db, actor: Actor, limit = 20) {
  if (!canSeeIntake(actor)) return [];
  return db.select({ id: pitches.id, code: pitches.pitchCode, title: pitches.title, creator: creators.fullName, at: pitches.createdAt })
    .from(pitches)
    .innerJoin(creators, eq(creators.id, pitches.creatorId))
    .leftJoin(pitchIntakeAcks, eq(pitchIntakeAcks.pitchId, pitches.id))
    .where(and(eq(pitches.submittedViaPortal, true), isNull(pitchIntakeAcks.pitchId), isNull(pitches.archivedAt)))
    .orderBy(desc(pitches.createdAt)).limit(limit);
}

export async function acknowledgeIntake(db: Db, actor: Actor, raw: unknown): Promise<{ ok: true }> {
  const { ids } = parseInput(z.object({ ids: z.array(z.uuid()).min(1).max(100) }).strict(), raw);
  if (!canSeeIntake(actor)) return { ok: true };
  const known = await db.select({ id: pitches.id }).from(pitches).where(and(inArray(pitches.id, ids), eq(pitches.submittedViaPortal, true)));
  if (known.length) await db.insert(pitchIntakeAcks).values(known.map((p) => ({ pitchId: p.id, acknowledgedBy: actor.userId }))).onConflictDoNothing();
  return { ok: true };
}
