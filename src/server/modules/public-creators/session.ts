/**
 * Starting a writer's session. Kept apart from auth.ts so the shared sign-in (auth/otp.ts) can start one without a circular
 * import: sign-in finds out whether a verified number belongs to staff, to a writer, or both.
 */
import { eq } from "drizzle-orm";
import type { Db } from "@/server/db/client";
import { publicCreatorSessions, publicCreators } from "@/server/db/schema";
import type { RequestContext } from "@/server/modules/audit/service";
import { hashToken, newToken } from "@/server/modules/auth/tokens";

export const CREATOR_SESSION_ABSOLUTE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days — an occasional-use identity, like the company portal
export const CREATOR_SESSION_IDLE_MS = 7 * 24 * 60 * 60 * 1000;      // 7 days

export interface PublicSession { token: string; expiresAt: Date }

export async function startPublicSession(db: Db, creatorId: string, ctx: RequestContext, now: Date): Promise<PublicSession> {
  const token = newToken();
  const expiresAt = new Date(now.getTime() + CREATOR_SESSION_ABSOLUTE_MS);
  await db.insert(publicCreatorSessions).values({ creatorId, tokenHash: hashToken(token), expiresAt, ip: ctx.ip ?? null, userAgent: ctx.userAgent?.slice(0, 512) ?? null });
  await db.update(publicCreators).set({ lastLoginAt: now }).where(eq(publicCreators.id, creatorId));
  return { token, expiresAt };
}
