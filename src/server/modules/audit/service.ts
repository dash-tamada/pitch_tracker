import { auditLogs } from "@/server/db/schema";
import type { DbOrTx } from "@/server/db/client";
import { redact } from "@/server/lib/pii";

export interface RequestContext {
  ip?: string | null;
  userAgent?: string | null;
  requestId?: string | null;
}

export interface AuditEntry {
  actorId: string | null;
  action: string;                 // e.g. "pitch.rejected", "auth.login_failed", "document.downloaded"
  resourceType: string;
  resourceId?: string | null;
  before?: unknown;
  after?: unknown;
}

/** Append-only. Sensitive keys are redacted before storage; the table cannot be updated or deleted by the app role. */
export async function writeAudit(db: DbOrTx, entry: AuditEntry, ctx: RequestContext = {}): Promise<void> {
  await db.insert(auditLogs).values({
    actorId: entry.actorId,
    action: entry.action,
    resourceType: entry.resourceType,
    resourceId: entry.resourceId ?? null,
    before: entry.before === undefined ? null : (redact(entry.before) as object),
    after: entry.after === undefined ? null : (redact(entry.after) as object),
    ip: ctx.ip ?? null,
    userAgent: ctx.userAgent?.slice(0, 512) ?? null,
    requestId: ctx.requestId ?? null,
  });
}
