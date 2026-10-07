/**
 * Local-development shortcut: skip the sign-in screen entirely.
 *
 * With `DEV_AUTO_LOGIN=<email>` set, a visitor without a session is signed in as that user automatically.
 * It issues a REAL session through the same `issueSession` a password sign-in uses, so permissions,
 * row-level security, idle timeouts and the audit trail all behave exactly as they would after a normal
 * sign-in — nothing downstream is faked or special-cased.
 *
 * It only works under `next dev` (NODE_ENV=development) and is refused outright when APP_ENV is
 * "production" or "staging", so copying an env file into a real deployment cannot open the door.
 *
 * `/login?real=1` still shows the real sign-in page, for working on it.
 */
import { and, eq, isNull } from "drizzle-orm";
import type { Db } from "@/server/db/client";
import { users } from "@/server/db/schema";
import { AppError } from "@/server/lib/errors";
import { writeAudit, type RequestContext } from "@/server/modules/audit/service";
import { issueSession, type LoginResult } from "./service";
import { hashIdentifier } from "./tokens";

export function devAutoLoginEmail(): string | null {
  if (process.env.APP_ENV === "production" || process.env.APP_ENV === "staging") return null;
  if (process.env.NODE_ENV !== "development") return null;
  const email = process.env.DEV_AUTO_LOGIN?.trim().toLowerCase();
  return email || null;
}

export async function devSignIn(db: Db, ctx: RequestContext = {}): Promise<LoginResult & { scope: "COMPANY" | "PLATFORM" }> {
  const email = devAutoLoginEmail();
  if (!email) throw new AppError("NOT_FOUND", "Not found.");
  const [user] = await db.select().from(users).where(and(eq(users.email, email), isNull(users.archivedAt)));
  if (!user || user.status !== "ACTIVE") {
    throw new AppError("VALIDATION", `DEV_AUTO_LOGIN user ${email} does not exist or is not active.`);
  }
  const result = await issueSession(db, user, { emailHash: hashIdentifier(email), ip: ctx.ip ?? null }, ctx, new Date());
  // issueSession records an ordinary auth.login; mark this one so the audit trail says how it happened.
  await writeAudit(db, { companyId: user.companyId, actorId: user.id, action: "auth.dev_auto_login", resourceType: "user", resourceId: user.id }, ctx);
  return { ...result, scope: user.scope };
}
