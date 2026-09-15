/** Global search. Every result set is filtered by the same permission and visibility rules as its own page. */
import { and, desc, eq, ilike, isNull, or, sql } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/server/db/client";
import { creators, pitches, platformPitches, platforms, users, workflowStages } from "@/server/db/schema";
import { normalizeEmail, normalizeMobile, normalizeName } from "@/server/lib/pii";
import { parseInput } from "@/server/lib/validation";
import { can, pitchVisibilityCondition, type Actor } from "@/server/modules/authz/policy";
import { escapeLike, toCreatorDto } from "@/server/modules/creators/service";

export async function globalSearch(db: Db, actor: Actor, raw: unknown) {
  const { q } = parseInput(z.object({ q: z.string().trim().min(2).max(120) }).strict(), raw);
  const like = `%${escapeLike(q)}%`;
  const digits = q.replace(/\D/g, "");
  const mobile = digits.length >= 10 ? normalizeMobile(q) : null;
  const email = q.includes("@") ? normalizeEmail(q) : null;
  const canPitches = can(actor, "pitch.view") || can(actor, "pitch.view_all");

  const [pitchHits, creatorHits, platformHits, peopleHits] = await Promise.all([
    canPitches ? db.select({ id: pitches.id, title: pitches.title, pitchCode: pitches.pitchCode, stageName: workflowStages.name, badge: workflowStages.badge,
        creatorName: creators.fullName, ownerName: users.fullName })
      .from(pitches).innerJoin(creators, eq(creators.id, pitches.creatorId)).leftJoin(users, eq(users.id, pitches.currentOwnerId))
      .leftJoin(workflowStages, and(eq(workflowStages.definitionId, pitches.workflowDefinitionId), eq(workflowStages.key, pitches.currentStageKey)))
      .where(and(pitchVisibilityCondition(actor), or(ilike(pitches.title, like), ilike(pitches.pitchCode, like), ilike(creators.fullName, like),
        ilike(users.fullName, like), ilike(pitches.currentStageKey, like), ...(mobile ? [eq(creators.mobileE164, mobile)] : []),
        ...(email ? [eq(creators.emailNormalized, email)] : []))!))
      .orderBy(desc(pitches.updatedAt)).limit(20) : Promise.resolve([]),
    can(actor, "creator.view") ? db.select().from(creators)
      .where(and(isNull(creators.archivedAt), or(ilike(creators.nameNormalized, `%${escapeLike(normalizeName(q))}%`),
        // Exact contact lookups: anyone who can see creators may find by exact number/email, but only PII holders see it unmasked.
        ...(mobile ? [eq(creators.mobileE164, mobile)] : []), ...(email ? [eq(creators.emailNormalized, email)] : []))!))
      .limit(10) : Promise.resolve([]),
    can(actor, "platform.view") ? db.select({ id: platforms.id, name: platforms.name,
        pending: sql<number>`(SELECT count(*)::int FROM platform_pitches pp JOIN pitches p ON p.id = pp.pitch_id
          WHERE pp.platform_id = "platforms"."id" AND pp.current_status NOT IN ('APPROVED','REJECTED','READY_FOR_DEVELOPMENT','GREENLIT')
          AND p.id IN (SELECT "pitches"."id" FROM "pitches" WHERE ${pitchVisibilityCondition(actor)}))` })
      .from(platforms).where(and(eq(platforms.active, true), ilike(platforms.name, like))).limit(10) : Promise.resolve([]),
    canPitches ? db.select({ id: users.id, fullName: users.fullName }).from(users).where(and(eq(users.status, "ACTIVE"), ilike(users.fullName, like))).limit(10)
      : Promise.resolve([]),
  ]);

  const platformPitchHits = platformHits.length && canPitches ? await db.select({ pitchId: pitches.id, title: pitches.title, platform: platforms.name, status: platformPitches.currentStatus })
    .from(platformPitches).innerJoin(pitches, eq(pitches.id, platformPitches.pitchId)).innerJoin(platforms, eq(platforms.id, platformPitches.platformId))
    .where(and(pitchVisibilityCondition(actor), ilike(platforms.name, like))).orderBy(desc(platformPitches.updatedAt)).limit(20) : [];

  return {
    pitches: pitchHits,
    creators: creatorHits.map((c) => { const d = toCreatorDto(actor, c); return { id: d.id, fullName: d.fullName, creatorType: d.creatorType, mobile: d.mobile }; }),
    platforms: platformHits, platformPitches: platformPitchHits, people: peopleHits,
  };
}
