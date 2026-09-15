import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/server/db/client";
import { savedFilters } from "@/server/db/schema";
import { notFound } from "@/server/lib/errors";
import { parseInput } from "@/server/lib/validation";
import type { Actor } from "@/server/modules/authz/policy";
import { listPitchesSchema } from "@/server/modules/pitches/service";

const filterQuery = listPitchesSchema.omit({ cursor: true, limit: true });

export const saveFilterSchema = z.object({ name: z.string().trim().min(1).max(120), query: z.record(z.string(), z.unknown()) }).strict();

/** Saved filters are private to their owner; the stored query is re-validated on save and whenever it is used. */
export async function listSavedFilters(db: Db, actor: Actor) {
  return db.select({ id: savedFilters.id, name: savedFilters.name, query: savedFilters.query }).from(savedFilters)
    .where(and(eq(savedFilters.userId, actor.userId), eq(savedFilters.scope, "PITCHES"))).orderBy(asc(savedFilters.name));
}

export async function saveFilter(db: Db, actor: Actor, raw: unknown) {
  const { name, query } = parseInput(saveFilterSchema, raw);
  const clean = parseInput(filterQuery, query);
  const stored = Object.fromEntries(Object.entries(clean).filter(([k, v]) => v !== undefined && !(k === "sort" && v === "newest")));
  const [row] = await db.insert(savedFilters).values({ userId: actor.userId, name, query: stored })
    .onConflictDoUpdate({ target: [savedFilters.userId, savedFilters.name], set: { query: stored } }).returning({ id: savedFilters.id });
  return row!;
}

export async function deleteSavedFilter(db: Db, actor: Actor, id: string) {
  const r = await db.delete(savedFilters).where(and(eq(savedFilters.id, id), eq(savedFilters.userId, actor.userId))).returning({ id: savedFilters.id });
  if (!r.length) throw notFound("Saved filter");
  return { id };
}

/** Converts a stored query back to URL search params for the pitch list. */
export function filterToSearchParams(query: unknown): string {
  const q = filterQuery.safeParse(query);
  if (!q.success) return "";
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(q.data)) {
    if (v === undefined) continue;
    p.set(k, Array.isArray(v) ? v.join(",") : String(v));
  }
  return p.toString();
}
