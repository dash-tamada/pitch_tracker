import { asc, eq, inArray } from "drizzle-orm";
import type { DbOrTx } from "@/server/db/client";
import { lookupValues, platforms, ratingCategories, users, workflowDefinitions, workflowStages } from "@/server/db/schema";

export type LookupMap = Record<string, { key: string; label: string; active: boolean }[]>;

export async function getLookups(db: DbOrTx): Promise<LookupMap> {
  const rows = await db.select({ type: lookupValues.type, key: lookupValues.key, label: lookupValues.label, active: lookupValues.active })
    .from(lookupValues).orderBy(asc(lookupValues.type), asc(lookupValues.sortOrder));
  const out: LookupMap = {};
  for (const r of rows) (out[r.type] ??= []).push({ key: r.key, label: r.label, active: r.active });
  return out;
}

export function labelOf(lookups: LookupMap, type: string, key: string | null | undefined): string {
  if (!key) return "—";
  return lookups[type]?.find((l) => l.key === key)?.label ?? key;
}

export async function getActiveStages(db: DbOrTx) {
  return db.select({ key: workflowStages.key, name: workflowStages.name, category: workflowStages.category, badge: workflowStages.badge, sortOrder: workflowStages.sortOrder })
    .from(workflowStages).innerJoin(workflowDefinitions, eq(workflowDefinitions.id, workflowStages.definitionId))
    .where(eq(workflowDefinitions.isActive, true)).orderBy(asc(workflowStages.sortOrder));
}

export async function getRatingCategories(db: DbOrTx) {
  return db.select().from(ratingCategories).where(eq(ratingCategories.active, true)).orderBy(asc(ratingCategories.sortOrder));
}

export async function getPlatformOptions(db: DbOrTx, includeInactive = false) {
  const q = db.select({ id: platforms.id, name: platforms.name, active: platforms.active }).from(platforms).orderBy(asc(platforms.name));
  return includeInactive ? q : q.where(eq(platforms.active, true));
}

/** Display names only — never emails — for showing who did what. */
export async function userNames(db: DbOrTx, ids: (string | null | undefined)[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter((x): x is string => Boolean(x)))];
  if (!unique.length) return new Map();
  const rows = await db.select({ id: users.id, fullName: users.fullName }).from(users).where(inArray(users.id, unique));
  return new Map(rows.map((r) => [r.id, r.fullName]));
}
