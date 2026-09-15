import { and, count, desc, eq, inArray, isNull, lt, sql } from "drizzle-orm";
import { z } from "zod";
import type { Db, DbOrTx } from "@/server/db/client";
import { jobOutbox, notifications, pitches } from "@/server/db/schema";
import { decodeCursor, encodeCursor, parseInput } from "@/server/lib/validation";
import type { Actor } from "@/server/modules/authz/policy";

export async function notify(db: DbOrTx, n: { userId: string; type: string; title: string; pitchId?: string | null; email?: boolean }) {
  const [row] = await db.insert(notifications).values({ userId: n.userId, type: n.type, title: n.title.slice(0, 200), pitchId: n.pitchId ?? null })
    .returning({ id: notifications.id });
  // The email job carries only an id; the worker renders a generic message with a link — never script or synopsis text.
  if (n.email !== false) await db.insert(jobOutbox).values({ type: "EMAIL_NOTIFICATION", payload: { notificationId: row!.id } });
  return row!;
}

const listSchema = z.object({ unread: z.enum(["1"]).optional(), cursor: z.string().max(300).optional(), limit: z.coerce.number().int().min(1).max(100).default(30) }).strict();

export async function listNotifications(db: Db, actor: Actor, raw: unknown) {
  const f = parseInput(listSchema, raw);
  const cursor = decodeCursor(f.cursor);
  const conds = [eq(notifications.userId, actor.userId)];
  if (f.unread) conds.push(isNull(notifications.readAt));
  if (cursor) conds.push(sql`(${notifications.createdAt}, ${notifications.id}) < (${cursor.createdAt}, ${cursor.id})`);
  const rows = await db.select({ id: notifications.id, type: notifications.type, title: notifications.title, pitchId: notifications.pitchId,
    pitchTitle: pitches.title, readAt: notifications.readAt, createdAt: notifications.createdAt })
    .from(notifications).leftJoin(pitches, eq(pitches.id, notifications.pitchId))
    .where(and(...conds)).orderBy(desc(notifications.createdAt), desc(notifications.id)).limit(f.limit + 1);
  const page = rows.slice(0, f.limit);
  const last = page.at(-1);
  return { items: page, nextCursor: rows.length > f.limit && last ? encodeCursor(last.createdAt, last.id) : null, unread: await unreadCount(db, actor) };
}

export async function unreadCount(db: Db, actor: Actor) {
  const [r] = await db.select({ n: count() }).from(notifications).where(and(eq(notifications.userId, actor.userId), isNull(notifications.readAt)));
  return r?.n ?? 0;
}

/** Users can only mark their own notifications — the user id is always part of the WHERE clause. */
export async function markRead(db: Db, actor: Actor, raw: unknown) {
  const { ids, all } = parseInput(z.object({ ids: z.array(z.uuid()).max(200).optional(), all: z.boolean().optional() }).strict(), raw);
  const where = all ? and(eq(notifications.userId, actor.userId), isNull(notifications.readAt))
    : and(eq(notifications.userId, actor.userId), inArray(notifications.id, ids ?? []), isNull(notifications.readAt));
  const r = await db.update(notifications).set({ readAt: new Date() }).where(where).returning({ id: notifications.id });
  return { updated: r.length };
}

export async function purgeOldNotifications(db: Db, olderThanDays = 180) {
  // Notifications are convenience copies; the authoritative history is workflow_events + audit_logs.
  const cutoff = new Date(Date.now() - olderThanDays * 86_400_000);
  await db.update(notifications).set({ readAt: sql`coalesce(${notifications.readAt}, now())` }).where(lt(notifications.createdAt, cutoff));
}
