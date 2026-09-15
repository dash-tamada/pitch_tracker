/**
 * Management reports and CSV exports. Exports obey the same visibility rules as the screens, need data.export,
 * neutralise spreadsheet formula injection, mask personal data for users without creator.view_pii,
 * and every export is written to the audit log with its filters and row count.
 */
import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/server/db/client";
import { creators, pitches, platforms, users, workflowEvents, workflowStages } from "@/server/db/schema";
import { safeCsvCell } from "@/server/lib/csv";
import { AppError } from "@/server/lib/errors";
import { maskEmail, maskMobile } from "@/server/lib/pii";
import { parseInput } from "@/server/lib/validation";
import { can, pitchVisibilityCondition, requirePermission, type Actor } from "@/server/modules/authz/policy";
import { writeAudit, type RequestContext } from "@/server/modules/audit/service";
import { breakdowns, agingPitches, dashboardSummary } from "@/server/modules/analytics/service";
import { listPitchesSchema, pitchFilterConditions } from "@/server/modules/pitches/service";

const MAX_EXPORT_ROWS = 50_000;

export async function employeeReport(db: Db, actor: Actor) {
  requirePermission(actor, "report.view");
  const visible = sql`${workflowEvents.pitchId} IN (SELECT "pitches"."id" FROM "pitches" WHERE ${pitchVisibilityCondition(actor)})`;
  const rows = await db.select({ userId: users.id, name: users.fullName,
    reviews: sql<number>`count(*) FILTER (WHERE ${workflowEvents.action} IN ('ACCEPT','FORWARD','REJECT','REQUEST_CHANGES','SEND_TO_PLATFORM','APPROVE','SEND_BACK'))::int`,
    accepted: sql<number>`count(*) FILTER (WHERE ${workflowEvents.action} = 'ACCEPT')::int`,
    rejected: sql<number>`count(*) FILTER (WHERE ${workflowEvents.action} = 'REJECT')::int`,
    forwarded: sql<number>`count(*) FILTER (WHERE ${workflowEvents.action} = 'FORWARD')::int`,
    avgReviewDays: sql<string | null>`round(avg(EXTRACT(EPOCH FROM (${workflowEvents.createdAt} - (
      SELECT p.created_at FROM workflow_events p WHERE p.pitch_id = "workflow_events"."pitch_id" AND p.seq = "workflow_events"."seq" - 1))) / 86400)
      FILTER (WHERE ${workflowEvents.action} IN ('ACCEPT','FORWARD','REJECT','REQUEST_CHANGES','SEND_TO_PLATFORM','APPROVE'))::numeric, 1)` })
    .from(workflowEvents).innerJoin(users, eq(users.id, workflowEvents.actorId)).where(visible)
    .groupBy(users.id, users.fullName).orderBy(desc(sql`count(*)`));
  const pct = (n: number, d: number) => (d ? Math.round((n / d) * 1000) / 10 : null);
  return rows.map((r) => ({ ...r, avgReviewDays: r.avgReviewDays === null ? null : Number(r.avgReviewDays),
    acceptanceRate: pct(r.accepted, r.accepted + r.rejected), rejectionRate: pct(r.rejected, r.accepted + r.rejected) }));
}

export async function managementReports(db: Db, actor: Actor) {
  requirePermission(actor, "report.view");
  const [summary, b, aging, employees] = await Promise.all([dashboardSummary(db, actor), breakdowns(db, actor), agingPitches(db, actor), employeeReport(db, actor)]);
  const bottlenecks = Object.values(aging.reduce<Record<string, { stage: string; count: number; maxDays: number }>>((acc, a) => {
    const k = a.stageName ?? a.stageKey;
    acc[k] ??= { stage: k, count: 0, maxDays: 0 };
    acc[k].count++; acc[k].maxDays = Math.max(acc[k].maxDays, a.days);
    return acc;
  }, {})).sort((x, y) => y.count - x.count);
  return { summary, byStage: b.byStage, byCreator: b.byCreator, byPlatform: b.byPlatform, employees, aging, bottlenecks };
}

export const EXPORT_KINDS = ["pitches", "creators", "platforms", "platform_performance", "rejections", "approvals", "workflow", "creator_performance"] as const;
export const exportSchema = z.object({ kind: z.enum(EXPORT_KINDS) }).catchall(z.unknown());

function toCsv(header: string[], rows: unknown[][]): string {
  // UTF-8 BOM so Excel opens Telugu/Hindi text correctly.
  return "\uFEFF" + [header, ...rows].map((r) => r.map(safeCsvCell).join(",")).join("\r\n") + "\r\n";
}

export async function exportCsv(db: Db, actor: Actor, raw: unknown, ctx: RequestContext = {}): Promise<{ filename: string; csv: string; rows: number }> {
  requirePermission(actor, "data.export");
  const { kind, ...rest } = parseInput(exportSchema, raw);
  const vis = pitchVisibilityCondition(actor);
  const pii = can(actor, "creator.view_pii");
  let header: string[] = [];
  let rows: unknown[][] = [];
  let filters: Record<string, unknown> = {};

  switch (kind) {
    case "pitches": {
      const f = parseInput(listPitchesSchema.omit({ cursor: true, limit: true }), rest);
      filters = f;
      const data = await db.select({ code: pitches.pitchCode, title: pitches.title, creator: creators.fullName, format: pitches.formatKey, language: pitches.languageKey,
        genre: pitches.genreKey, priority: pitches.priority, stage: workflowStages.name, owner: users.fullName, since: pitches.stageEnteredAt, created: pitches.createdAt })
        .from(pitches).innerJoin(creators, eq(creators.id, pitches.creatorId)).leftJoin(users, eq(users.id, pitches.currentOwnerId))
        .leftJoin(workflowStages, and(eq(workflowStages.definitionId, pitches.workflowDefinitionId), eq(workflowStages.key, pitches.currentStageKey)))
        .where(and(...pitchFilterConditions(actor, { ...f, limit: 1, sort: f.sort ?? "newest" }))).orderBy(desc(pitches.createdAt)).limit(MAX_EXPORT_ROWS + 1);
      header = ["Pitch ID", "Title", "Creator", "Format", "Language", "Genre", "Priority", "Status", "Current owner", "In stage since", "Created"];
      rows = data.map((d) => [d.code, d.title, d.creator, d.format, d.language, d.genre, d.priority, d.stage, d.owner, d.since.toISOString(), d.created.toISOString()]);
      break;
    }
    case "creators": {
      const data = await db.select().from(creators).where(sql`${creators.archivedAt} IS NULL`).orderBy(creators.fullName).limit(MAX_EXPORT_ROWS + 1);
      header = ["Name", "Type", "Mobile", "Email", "Location", "Languages", "Years experience", "Agency"];
      rows = data.map((c) => [c.fullName, c.creatorType, pii ? c.mobileE164 : maskMobile(c.mobileE164), pii ? c.emailNormalized : maskEmail(c.emailNormalized),
        c.location, c.languageKeys.join(" "), c.yearsExperience, c.agency]);
      break;
    }
    case "platforms": {
      const data = await db.select().from(platforms).orderBy(platforms.name);
      header = ["Platform", "Type", "Active", "Languages", "Genres", "Preferences"];
      rows = data.map((p) => [p.name, p.kind, p.active ? "Yes" : "No", p.languageKeys.join(" "), p.genreKeys.join(" "), p.preferences]);
      break;
    }
    case "platform_performance": {
      const b = await breakdowns(db, actor);
      header = ["Platform", "Pitched", "Interested", "Approved", "Rejected", "On hold", "Approval rate %"];
      rows = b.byPlatform.map((p) => [p.name, p.pitched, p.interested, p.approved, p.rejected, p.onHold, p.approvalRate]);
      break;
    }
    case "creator_performance": {
      const b = await breakdowns(db, actor);
      header = ["Creator", "Pitches", "CEO/COO approved", "Approval rate %"];
      rows = b.byCreator.map((c) => [c.name, c.total, c.approved, c.approvalRate]);
      break;
    }
    case "rejections":
    case "approvals":
    case "workflow": {
      const actions = kind === "rejections" ? ["REJECT"] : kind === "approvals" ? ["SEND_TO_PLATFORM", "APPROVE", "GREENLIGHT", "MARK_PLATFORM_APPROVED"] : null;
      const data = await db.select({ at: workflowEvents.createdAt, code: pitches.pitchCode, title: pitches.title, action: workflowEvents.action, from: workflowEvents.fromStageKey,
        to: workflowEvents.toStageKey, by: users.fullName, approvalType: workflowEvents.approvalType, category: workflowEvents.rejectionCategoryKey,
        reason: workflowEvents.rejectionReason, remarks: workflowEvents.remarks, platform: platforms.name })
        .from(workflowEvents).innerJoin(pitches, eq(pitches.id, workflowEvents.pitchId)).innerJoin(users, eq(users.id, workflowEvents.actorId))
        .leftJoin(platforms, eq(platforms.id, workflowEvents.platformId))
        .where(and(vis, ...(actions ? [sql`${workflowEvents.action}::text IN (${sql.join(actions.map((a) => sql`${a}`), sql`, `)})`] : [])))
        .orderBy(desc(workflowEvents.createdAt)).limit(MAX_EXPORT_ROWS + 1);
      header = ["When", "Pitch ID", "Title", "Action", "From", "To", "By", "Approval type", "Rejection category", "Rejection reason", "Remarks", "Platform"];
      rows = data.map((d) => [d.at.toISOString(), d.code, d.title, d.action, d.from, d.to, d.by, d.approvalType, d.category, d.reason, d.remarks, d.platform]);
      break;
    }
  }
  if (rows.length > MAX_EXPORT_ROWS) throw new AppError("VALIDATION", `Export is limited to ${MAX_EXPORT_ROWS} rows. Narrow the filters.`);
  await writeAudit(db, { actorId: actor.userId, action: "data.exported", resourceType: "export", after: { kind, filters, rows: rows.length, piiMasked: !pii } }, ctx);
  const stamp = new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
  return { filename: `pitch-tracker-${kind}-${stamp}.csv`, csv: toCsv(header, rows), rows: rows.length };
}

