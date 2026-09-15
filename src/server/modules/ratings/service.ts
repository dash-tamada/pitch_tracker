/** Ratings are append-only records tied to a reviewer and a pitch; creator ratings are always computed. */
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/server/db/client";
import { pitches, ratingCategories, ratingScores, ratings, users } from "@/server/db/schema";
import { AppError } from "@/server/lib/errors";
import { parseInput } from "@/server/lib/validation";
import { can, pitchVisibilityCondition, requirePermission, type Actor } from "@/server/modules/authz/policy";
import { writeAudit, type RequestContext } from "@/server/modules/audit/service";
import { getSettings } from "@/server/modules/settings/service";
import { loadVisiblePitch } from "@/server/modules/workflow/engine";

export const addRatingSchema = z.object({
  overall: z.number().int().min(1).max(5),
  scores: z.array(z.object({ categoryKey: z.string().trim().min(1).max(60), score: z.number().int().min(1).max(5) }).strict()).max(20).default([]),
  comments: z.string().trim().max(5000).optional(),
}).strict();

export async function addPitchRating(db: Db, actor: Actor, pitchId: string, raw: unknown, ctx: RequestContext = {}) {
  requirePermission(actor, "rating.add");
  const input = parseInput(addRatingSchema, raw);
  return db.transaction(async (tx) => {
    const pitch = await loadVisiblePitch(tx, actor, pitchId, false);
    const [r] = await tx.insert(ratings).values({ creatorId: pitch.creatorId, pitchId, reviewerId: actor.userId,
      overall: input.overall, comments: input.comments ?? null }).returning({ id: ratings.id });
    if (input.scores.length) {
      const keys = [...new Set(input.scores.map((s) => s.categoryKey))];
      if (keys.length !== input.scores.length) throw new AppError("VALIDATION", "Each category can be scored once.", { scores: "Duplicate" });
      const cats = await tx.select().from(ratingCategories).where(and(inArray(ratingCategories.key, keys), eq(ratingCategories.active, true)));
      if (cats.length !== keys.length) throw new AppError("VALIDATION", "Unknown rating category.", { scores: "Invalid" });
      const byKey = new Map(cats.map((c) => [c.key, c.id]));
      await tx.insert(ratingScores).values(input.scores.map((s) => ({ ratingId: r!.id, categoryId: byKey.get(s.categoryKey)!, score: s.score })));
    }
    await writeAudit(tx, { actorId: actor.userId, action: "rating.added", resourceType: "pitch", resourceId: pitchId,
      after: { ratingId: r!.id, creatorId: pitch.creatorId, overall: input.overall } }, ctx);
    return r!;
  });
}

/** Ratings visibility is an Admin setting: MANAGEMENT (rating.view) or ALL_EMPLOYEES (rating.add or rating.view). */
export async function canSeeRatings(db: Db, actor: Actor): Promise<boolean> {
  if (can(actor, "rating.view")) return true;
  const s = await getSettings(db);
  return s.ratings_visibility === "ALL_EMPLOYEES" && can(actor, "rating.add");
}

export async function creatorRatings(db: Db, actor: Actor, creatorId: string) {
  if (!(await canSeeRatings(db, actor))) throw new AppError("FORBIDDEN", "Ratings are visible to management only.");
  const visible = and(eq(ratings.creatorId, creatorId), pitchVisibilityCondition(actor));
  const history = await db.select({ id: ratings.id, pitchId: ratings.pitchId, pitchTitle: pitches.title, reviewerId: ratings.reviewerId,
    reviewerName: users.fullName, overall: ratings.overall, comments: ratings.comments, createdAt: ratings.createdAt })
    .from(ratings).innerJoin(pitches, eq(pitches.id, ratings.pitchId)).innerJoin(users, eq(users.id, ratings.reviewerId))
    .where(visible).orderBy(desc(ratings.createdAt)).limit(200);
  const [summary] = await db.select({ average: sql<string | null>`round(avg(${ratings.overall})::numeric, 2)`, count: sql<number>`count(*)::int` })
    .from(ratings).innerJoin(pitches, eq(pitches.id, ratings.pitchId)).where(visible);
  const byCategory = await db.select({ key: ratingCategories.key, label: ratingCategories.label,
    average: sql<string>`round(avg(${ratingScores.score})::numeric, 2)`, count: sql<number>`count(*)::int` })
    .from(ratingScores).innerJoin(ratings, eq(ratings.id, ratingScores.ratingId)).innerJoin(pitches, eq(pitches.id, ratings.pitchId))
    .innerJoin(ratingCategories, eq(ratingCategories.id, ratingScores.categoryId))
    .where(visible).groupBy(ratingCategories.key, ratingCategories.label, ratingCategories.sortOrder).orderBy(asc(ratingCategories.sortOrder));
  const trend = await db.select({ month: sql<string>`to_char(date_trunc('month', ${ratings.createdAt}), 'YYYY-MM')`,
    average: sql<string>`round(avg(${ratings.overall})::numeric, 2)`, count: sql<number>`count(*)::int` })
    .from(ratings).innerJoin(pitches, eq(pitches.id, ratings.pitchId)).where(visible)
    .groupBy(sql`date_trunc('month', ${ratings.createdAt})`).orderBy(sql`date_trunc('month', ${ratings.createdAt})`);
  const scores = history.length ? await db.select({ ratingId: ratingScores.ratingId, key: ratingCategories.key, score: ratingScores.score })
    .from(ratingScores).innerJoin(ratingCategories, eq(ratingCategories.id, ratingScores.categoryId))
    .where(inArray(ratingScores.ratingId, history.map((h) => h.id))) : [];
  return {
    average: summary?.average === null || summary?.average === undefined ? null : Number(summary.average),
    count: summary?.count ?? 0,
    byCategory: byCategory.map((c) => ({ ...c, average: Number(c.average) })),
    trend: trend.map((t) => ({ ...t, average: Number(t.average) })),
    history: history.map((h) => ({ ...h, scores: scores.filter((s) => s.ratingId === h.id).map(({ key, score }) => ({ key, score })) })),
  };
}
