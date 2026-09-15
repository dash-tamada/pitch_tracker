import { and, eq, gt, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/server/db/client";
import { loginAttempts, sessions, users } from "@/server/db/schema";
import { AppError } from "@/server/lib/errors";
import { writeAudit, type RequestContext } from "@/server/modules/audit/service";
import { loadActor } from "@/server/modules/authz/actor";
import { MFA_REQUIRED_ROLES, type RoleKey } from "@/server/modules/authz/permissions";
import type { Actor } from "@/server/modules/authz/policy";
import { getDummyHash, verifyPassword } from "./password";
import { hashIdentifier, hashToken, newToken } from "./tokens";

export const SESSION_ABSOLUTE_MS = 12 * 60 * 60 * 1000;  // 12 h
export const SESSION_IDLE_MS = 30 * 60 * 1000;           // 30 min
export const LOCKOUT_THRESHOLD = 5;                       // consecutive failures per account
export const LOCKOUT_MS = 15 * 60 * 1000;
export const IP_WINDOW_MS = 15 * 60 * 1000;
export const IP_MAX_FAILURES = 30;                        // per IP per window (credential stuffing)

export const loginSchema = z.object({
  email: z.email().max(254),
  password: z.string().min(1).max(128),
}).strict();

export interface LoginResult { token: string; expiresAt: Date; mfaRequired: boolean }

const INVALID = () => new AppError("INVALID_CREDENTIALS", "Email or password is incorrect.");

export async function login(db: Db, raw: unknown, ctx: RequestContext = {}, now = new Date()): Promise<LoginResult> {
  const parsed = loginSchema.safeParse(raw);
  if (!parsed.success) throw INVALID();
  const email = parsed.data.email.trim().toLowerCase();
  const emailHash = hashIdentifier(email);
  const ip = ctx.ip ?? null;

  if (ip) {
    const [{ n } = { n: 0 }] = await db.select({ n: sql<number>`count(*)::int` }).from(loginAttempts)
      .where(and(eq(loginAttempts.ip, ip), eq(loginAttempts.success, false), gt(loginAttempts.createdAt, new Date(now.getTime() - IP_WINDOW_MS))));
    if (n >= IP_MAX_FAILURES) {
      await writeAudit(db, { actorId: null, action: "auth.rate_limited", resourceType: "auth" }, ctx);
      throw new AppError("RATE_LIMITED", "Too many attempts. Please wait and try again.");
    }
  }

  const [user] = await db.select().from(users).where(and(eq(users.email, email), isNull(users.archivedAt)));

  if (!user || !user.passwordHash) {
    await verifyPassword(await getDummyHash(), parsed.data.password); // equalise timing
    await db.insert(loginAttempts).values({ emailHash, ip, success: false });
    await writeAudit(db, { actorId: null, action: "auth.login_failed", resourceType: "auth" }, ctx);
    throw INVALID();
  }

  if (user.lockedUntil && user.lockedUntil > now) {
    await db.insert(loginAttempts).values({ emailHash, ip, success: false });
    await writeAudit(db, { actorId: user.id, action: "auth.login_blocked_locked", resourceType: "user", resourceId: user.id }, ctx);
    // Same message as bad credentials would leak nothing extra, but users need to know to wait.
    throw new AppError("ACCOUNT_LOCKED", "Too many failed attempts. Try again in 15 minutes or reset your password.");
  }

  const ok = await verifyPassword(user.passwordHash, parsed.data.password);
  if (!ok || user.status !== "ACTIVE") {
    const failures = user.failedLoginCount + 1;
    await db.update(users).set({
      failedLoginCount: failures,
      lockedUntil: failures >= LOCKOUT_THRESHOLD ? new Date(now.getTime() + LOCKOUT_MS) : user.lockedUntil,
    }).where(eq(users.id, user.id));
    await db.insert(loginAttempts).values({ emailHash, ip, success: false });
    await writeAudit(db, { actorId: user.id, action: failures >= LOCKOUT_THRESHOLD ? "auth.account_locked" : "auth.login_failed",
      resourceType: "user", resourceId: user.id }, ctx);
    throw INVALID();
  }

  const actor = await loadActor(db, user.id, false);
  const mfaRequired = user.mfaEnabled || [...(actor?.roles ?? [])].some((r) => MFA_REQUIRED_ROLES.has(r as RoleKey));

  const token = newToken();
  const expiresAt = new Date(now.getTime() + SESSION_ABSOLUTE_MS);
  await db.transaction(async (tx) => {
    await tx.update(users).set({ failedLoginCount: 0, lockedUntil: null, lastLoginAt: now }).where(eq(users.id, user.id));
    await tx.insert(sessions).values({ userId: user.id, tokenHash: hashToken(token), mfaVerified: !mfaRequired,
      expiresAt, ip, userAgent: ctx.userAgent?.slice(0, 512) ?? null });
    await tx.insert(loginAttempts).values({ emailHash, ip, success: true });
    await writeAudit(tx, { actorId: user.id, action: "auth.login", resourceType: "user", resourceId: user.id }, ctx);
  });
  return { token, expiresAt, mfaRequired };
}

export interface SessionInfo { sessionId: string; actor: Actor; mfaVerified: boolean }

/** Resolves a raw cookie token to an actor. Enforces revocation, absolute expiry and idle timeout. */
export async function resolveSession(db: Db, token: string | undefined, now = new Date()): Promise<SessionInfo | null> {
  if (!token || token.length > 128) return null;
  const [s] = await db.select().from(sessions).where(eq(sessions.tokenHash, hashToken(token)));
  if (!s || s.revokedAt || s.expiresAt <= now || now.getTime() - s.lastSeenAt.getTime() > SESSION_IDLE_MS) return null;
  const actor = await loadActor(db, s.userId, s.mfaVerified);
  if (!actor) return null;
  if (now.getTime() - s.lastSeenAt.getTime() > 60_000) {
    await db.update(sessions).set({ lastSeenAt: now }).where(eq(sessions.id, s.id));
  }
  return { sessionId: s.id, actor, mfaVerified: s.mfaVerified };
}

export async function logout(db: Db, token: string | undefined, ctx: RequestContext = {}): Promise<void> {
  if (!token) return;
  const [s] = await db.update(sessions).set({ revokedAt: new Date() })
    .where(and(eq(sessions.tokenHash, hashToken(token)), isNull(sessions.revokedAt)))
    .returning({ userId: sessions.userId });
  if (s) await writeAudit(db, { actorId: s.userId, action: "auth.logout", resourceType: "user", resourceId: s.userId }, ctx);
}

/** Revoke every session for a user (password change, role change, disable). */
export async function revokeAllSessions(db: Db, userId: string): Promise<void> {
  await db.update(sessions).set({ revokedAt: new Date() }).where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)));
}
