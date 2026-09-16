/**
 * Background jobs: email outbox, follow-up reminders, aging alerts, projection reconciliation, retention clean-up.
 * Company jobs take a company-scoped handle and are run once per company (see runAllCompanies), so a job can never
 * read or notify across companies. Identity clean-up runs separately on the identity connection.
 */
import { and, asc, eq, inArray, isNull, lt, lte, sql } from "drizzle-orm";
import type { Db } from "@/server/db/client";
import {
  followUps, jobOutbox, loginAttempts, notifications, pitches, platformPitches, platforms, sessions, uploadIntents, users, workflowEvents,
} from "@/server/db/schema";
import { writeAudit } from "@/server/modules/audit/service";
import { getSettings } from "@/server/modules/settings/service";
import { loadStages } from "@/server/modules/workflow/engine";
import { foldEvents } from "@/server/modules/workflow/rules";
import type { StoragePort } from "@/server/modules/storage/port";
import type { EmailPort } from "./email";

const APP_ORIGIN = () => process.env.APP_ORIGIN ?? "http://localhost:3000";

export async function processOutbox(db: Db, email: EmailPort, limit = 50) {
  // SKIP LOCKED lets several workers run safely at once.
  const jobs = await db.transaction(async (tx) => {
    const rows = await tx.select().from(jobOutbox)
      .where(and(eq(jobOutbox.status, "PENDING"), lte(jobOutbox.runAfter, new Date()))).orderBy(asc(jobOutbox.createdAt)).limit(limit).for("update", { skipLocked: true });
    if (rows.length) await tx.update(jobOutbox).set({ status: "RUNNING", attempts: sql`${jobOutbox.attempts} + 1` }).where(inArray(jobOutbox.id, rows.map((r) => r.id)));
    return rows;
  });
  let done = 0, failed = 0;
  for (const job of jobs) {
    try {
      if (job.type === "EMAIL_NOTIFICATION") {
        const { notificationId } = job.payload as { notificationId: string };
        const [n] = await db.select({ title: notifications.title, pitchId: notifications.pitchId, email: users.email, status: users.status })
          .from(notifications).innerJoin(users, eq(users.id, notifications.userId)).where(eq(notifications.id, notificationId));
        if (n && n.status === "ACTIVE") {
          const link = n.pitchId ? `${APP_ORIGIN()}/pitches/${n.pitchId}` : `${APP_ORIGIN()}/notifications`;
          await email.send({ to: n.email, subject: "Pitch Tracker: you have a new update", text: `${n.title}\n\nOpen Pitch Tracker to see details: ${link}\n\n(Details are only visible after signing in.)` });
        }
        await db.update(jobOutbox).set({ status: "DONE" }).where(eq(jobOutbox.id, job.id));
      } else if (job.type === "EMAIL_INVITATION") {
        const { userId, token } = job.payload as { userId: string; token?: string };
        const [u] = await db.select({ email: users.email, status: users.status }).from(users).where(eq(users.id, userId));
        if (u && token && u.status === "INVITED") await email.send({ to: u.email, subject: "You're invited to Pitch Tracker", text: `You have been invited to join your company's Pitch Tracker.\n\nChoose your password within 72 hours:\n${APP_ORIGIN()}/accept-invite#${token}\n\nIf you were not expecting this, ignore this email.` });
        await db.update(jobOutbox).set({ status: "DONE", payload: { userId } }).where(eq(jobOutbox.id, job.id));
      } else if (job.type === "EMAIL_PASSWORD_RESET") {
        const { userId, token } = job.payload as { userId: string; token?: string };
        const [u] = await db.select({ email: users.email }).from(users).where(eq(users.id, userId));
        if (u && token) await email.send({ to: u.email, subject: "Pitch Tracker password reset", text: `Use this link within 30 minutes to set a new password:\n${APP_ORIGIN()}/set-password#${token}\n\nIf you did not ask for this, ignore this email.` });
        // Remove the raw token from the database as soon as it has been handed to the mail transport.
        await db.update(jobOutbox).set({ status: "DONE", payload: { userId } }).where(eq(jobOutbox.id, job.id));
      } else {
        await db.update(jobOutbox).set({ status: "FAILED", lastError: "unknown job type" }).where(eq(jobOutbox.id, job.id));
      }
      done++;
    } catch (e) {
      failed++;
      const attempts = job.attempts + 1;
      await db.update(jobOutbox).set({ status: attempts >= 5 ? "FAILED" : "PENDING", lastError: (e instanceof Error ? e.name : "error").slice(0, 200),
        runAfter: new Date(Date.now() + 2 ** attempts * 60_000) }).where(eq(jobOutbox.id, job.id));
    }
  }
  return { done, failed };
}

const istDate = (d = new Date()) => new Date(d.getTime() + 5.5 * 3600_000).toISOString().slice(0, 10);

export async function followUpReminders(db: Db, now = new Date()) {
  const today = istDate(now);
  const due = await db.select({ id: followUps.id, assigneeId: followUps.assigneeId, pitchId: pitches.id, title: pitches.title, platform: platforms.name, dueOn: followUps.dueOn })
    .from(followUps).innerJoin(platformPitches, eq(platformPitches.id, followUps.platformPitchId)).innerJoin(pitches, eq(pitches.id, platformPitches.pitchId))
    .innerJoin(platforms, eq(platforms.id, platformPitches.platformId)).where(and(isNull(followUps.completedAt), lte(followUps.dueOn, today)));
  let sent = 0;
  for (const f of due) {
    const type = `followup.due.${f.id}.${today}`;
    const [exists] = await db.select({ id: notifications.id }).from(notifications).where(and(eq(notifications.userId, f.assigneeId), eq(notifications.type, type)));
    if (exists) continue;
    const [n] = await db.insert(notifications).values({ userId: f.assigneeId, type, pitchId: f.pitchId,
      title: `${f.dueOn < today ? "Overdue" : "Due today"}: follow up with ${f.platform} on "${f.title}".` }).returning({ id: notifications.id });
    await db.insert(jobOutbox).values({ type: "EMAIL_NOTIFICATION", payload: { notificationId: n!.id } });
    sent++;
  }
  return { sent };
}

export async function agingAlerts(db: Db, now = new Date()) {
  const t = (await getSettings(db)).aging_thresholds_days;
  const rows = await db.select({ id: pitches.id, title: pitches.title, ownerId: pitches.currentOwnerId, since: pitches.stageEnteredAt, stage: pitches.currentStageKey })
    .from(pitches).where(and(isNull(pitches.archivedAt), lte(pitches.stageEnteredAt, new Date(now.getTime() - t.attention * 86_400_000)),
      sql`${pitches.currentStageKey} NOT IN ('REJECTED','RELEASED','COMPLETED')`, sql`${pitches.currentOwnerId} IS NOT NULL`));
  let sent = 0;
  for (const p of rows) {
    const days = Math.floor((now.getTime() - p.since.getTime()) / 86_400_000);
    const level = days >= t.critical ? "critical" : days >= t.overdue ? "overdue" : "attention";
    // One alert per pitch, per stage entry, per level — business status is never changed automatically.
    const type = `aging.${level}.${p.since.getTime()}`;
    const [exists] = await db.select({ id: notifications.id }).from(notifications).where(and(eq(notifications.pitchId, p.id), eq(notifications.type, type)));
    if (exists) continue;
    const [n] = await db.insert(notifications).values({ userId: p.ownerId!, type, pitchId: p.id, title: `"${p.title}" has been waiting ${days} days for your action.` }).returning({ id: notifications.id });
    await db.insert(jobOutbox).values({ type: "EMAIL_NOTIFICATION", payload: { notificationId: n!.id } });
    sent++;
  }
  return { sent };
}

/** Business rule 20: current stage/owner must equal a fold of the event log. Drift is logged as a security event. */
export async function reconcileProjections(db: Db, batch = 500) {
  const rows: (typeof pitches.$inferSelect)[] = [];
  for (let last = "00000000-0000-0000-0000-000000000000"; ;) {
    const page = await db.select().from(pitches).where(sql`${pitches.id} > ${last}`).orderBy(asc(pitches.id)).limit(batch);
    rows.push(...page);
    if (page.length < batch) break;
    last = page.at(-1)!.id;
  }
  const drift: string[] = [];
  const stageCache = new Map<string, Awaited<ReturnType<typeof loadStages>>>();
  for (const p of rows) {
    const events = await db.select().from(workflowEvents).where(eq(workflowEvents.pitchId, p.id)).orderBy(asc(workflowEvents.seq));
    if (!stageCache.has(p.workflowDefinitionId)) stageCache.set(p.workflowDefinitionId, await loadStages(db, p.workflowDefinitionId));
    const f = foldEvents(events, stageCache.get(p.workflowDefinitionId)!);
    if (f.currentStageKey !== p.currentStageKey || f.currentOwnerId !== p.currentOwnerId || f.lastEventSeq !== p.lastEventSeq) drift.push(p.id);
  }
  for (const id of drift) await writeAudit(db, { actorId: null, action: "security.projection_drift", resourceType: "pitch", resourceId: id });
  return { checked: rows.length, drift: drift.length };
}

/** Identity connection: expired sessions and old sign-in attempts. */
export async function identityCleanup(platformDb: Db, now = new Date()) {
  await platformDb.delete(sessions).where(lt(sessions.expiresAt, new Date(now.getTime() - 7 * 86_400_000)));
  await platformDb.delete(loginAttempts).where(lt(loginAttempts.createdAt, new Date(now.getTime() - 90 * 86_400_000)));
}

/** Company handle: abandoned uploads of this company only. */
export async function retentionCleanup(db: Db, storage: StoragePort, now = new Date()) {
  const stale = await db.select({ id: uploadIntents.id, key: uploadIntents.quarantineKey }).from(uploadIntents)
    .where(and(isNull(uploadIntents.completedAt), isNull(uploadIntents.rejectedReason), lt(uploadIntents.expiresAt, now))).limit(500);
  if (stale.length) {
    await storage.remove(stale.map((s) => s.key)).catch(() => undefined);
    await db.update(uploadIntents).set({ rejectedReason: "expired" }).where(inArray(uploadIntents.id, stale.map((s) => s.id)));
  }
  return { expiredUploads: stale.length };
}
