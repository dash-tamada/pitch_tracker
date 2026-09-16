/**
 * Plan limits, read from the database (plans.limits merged with subscriptions.limit_overrides).
 * Nothing here is hard-coded: a missing or null limit means "unlimited".
 * All functions take a company-scoped handle; RLS guarantees they only ever see the caller's company.
 */
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import type { DbOrTx } from "@/server/db/client";
import { documentVersions, pitchImages, pitches, plans, subscriptions, users } from "@/server/db/schema";
import { AppError } from "@/server/lib/errors";

export type LimitKey = "max_users" | "max_pitches" | "storage_bytes" | "max_file_bytes";
export type Limits = Partial<Record<LimitKey, number | null>>;

const BLOCKED_SUBSCRIPTION = new Set(["SUSPENDED", "EXPIRED", "CANCELLED"]);

export async function companyLimits(db: DbOrTx): Promise<{ limits: Limits; subscriptionStatus: string | null; planKey: string | null }> {
  const [row] = await db.select({ planLimits: plans.limits, overrides: subscriptions.limitOverrides, status: subscriptions.status, planKey: subscriptions.planKey })
    .from(subscriptions).innerJoin(plans, eq(plans.key, subscriptions.planKey))
    .where(eq(subscriptions.companyId, sql`public.app_company_id()`));
  if (!row) return { limits: {}, subscriptionStatus: null, planKey: null };
  return { limits: { ...(row.planLimits as Limits), ...(row.overrides as Limits) }, subscriptionStatus: row.status, planKey: row.planKey };
}

/** Serialises limit checks per company inside the caller's transaction, so two parallel requests cannot both pass. */
async function lockCompanyMetric(tx: DbOrTx, metric: string) {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${metric} || ':' || coalesce(public.app_company_id()::text, '')))`);
}

async function assertSubscriptionUsable(db: DbOrTx) {
  const { subscriptionStatus } = await companyLimits(db);
  if (subscriptionStatus && BLOCKED_SUBSCRIPTION.has(subscriptionStatus)) {
    throw new AppError("PLAN_LIMIT", "Your company's subscription is not active. Please contact your company administrator.");
  }
}

/** Call inside the transaction that creates the user. Counts active + invited, non-archived company users. */
export async function assertCanAddUser(tx: DbOrTx) {
  await lockCompanyMetric(tx, "users");
  await assertSubscriptionUsable(tx);
  const { limits } = await companyLimits(tx);
  if (limits.max_users == null) return;
  const [r] = await tx.select({ n: sql<number>`count(*)::int` }).from(users)
    .where(and(isNull(users.archivedAt), inArray(users.status, ["ACTIVE", "INVITED"])));
  if ((r?.n ?? 0) >= limits.max_users) {
    throw new AppError("PLAN_LIMIT", `Your plan allows ${limits.max_users} users. Disable someone or ask for a plan upgrade.`);
  }
}

export async function assertCanAddPitch(tx: DbOrTx) {
  await lockCompanyMetric(tx, "pitches");
  await assertSubscriptionUsable(tx);
  const { limits } = await companyLimits(tx);
  if (limits.max_pitches == null) return;
  const [r] = await tx.select({ n: sql<number>`count(*)::int` }).from(pitches).where(isNull(pitches.archivedAt));
  if ((r?.n ?? 0) >= limits.max_pitches) throw new AppError("PLAN_LIMIT", `Your plan allows ${limits.max_pitches} active pitches.`);
}

export async function storageUsedBytes(db: DbOrTx): Promise<number> {
  const [d] = await db.select({ n: sql<string>`coalesce(sum(${documentVersions.sizeBytes}), 0)` }).from(documentVersions);
  const [i] = await db.select({ n: sql<string>`coalesce(sum(${pitchImages.sizeBytes}), 0)` }).from(pitchImages);
  return Number(d?.n ?? 0) + Number(i?.n ?? 0);
}

/** Checks single-file size and total storage before accepting bytes. */
export async function assertCanStore(tx: DbOrTx, sizeBytes: number) {
  await assertSubscriptionUsable(tx);
  const { limits } = await companyLimits(tx);
  if (limits.max_file_bytes != null && sizeBytes > limits.max_file_bytes) {
    throw new AppError("PLAN_LIMIT", `Your plan allows files up to ${Math.floor(limits.max_file_bytes / 1048576)} MB.`, { file: "Too large" });
  }
  if (limits.storage_bytes != null && (await storageUsedBytes(tx)) + sizeBytes > limits.storage_bytes) {
    throw new AppError("PLAN_LIMIT", "Your company has used all of its storage. Remove old files or ask for a plan upgrade.", { file: "Storage full" });
  }
}
