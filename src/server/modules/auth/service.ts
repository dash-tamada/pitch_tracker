import { and, eq, gt, isNull, ne, sql } from "drizzle-orm";
import { z } from "zod";
import type { Db, DbOrTx } from "@/server/db/client";
import { companies, loginAttempts, sessions, users } from "@/server/db/schema";
import { AppError } from "@/server/lib/errors";
import { writeAudit, type RequestContext } from "@/server/modules/audit/service";
import { loadActor } from "@/server/modules/authz/actor";
import { MFA_REQUIRED_ROLES, type RoleKey } from "@/server/modules/authz/permissions";
import type { Actor } from "@/server/modules/authz/policy";
import { parseInput } from "@/server/lib/validation";
import { getDummyHash, hashPassword, passwordPolicyErrors, verifyPassword } from "./password";
import { hashIdentifier, hashToken, newToken } from "./tokens";
import { decryptSecret, verifyTotp } from "./totp";

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

export interface LoginResult { token: string; expiresAt: Date; mfaRequired: boolean; mfaEnrolmentRequired: boolean; mustChangePassword: boolean }

const INVALID = () => new AppError("INVALID_CREDENTIALS", "Email or password is incorrect.");

/** Company states in which nobody from that company may sign in or keep using a session. */
export const BLOCKED_COMPANY_STATUSES: ReadonlySet<string> = new Set(["SUSPENDED", "EXPIRED", "ARCHIVED"]);
const COMPANY_UNAVAILABLE = () => new AppError("COMPANY_UNAVAILABLE", "Your company's account is not active. Please contact your company administrator.");

/*
 * Every function here runs on the identity connection (pitch_platform, getPlatformDb()):
 * sign-in happens before any company is known, so it cannot use the company-scoped role.
 */

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
    await writeAudit(db, { companyId: user.companyId, actorId: user.id, action: "auth.login_blocked_locked", resourceType: "user", resourceId: user.id }, ctx);
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
    await writeAudit(db, { companyId: user.companyId, actorId: user.id, action: failures >= LOCKOUT_THRESHOLD ? "auth.account_locked" : "auth.login_failed",
      resourceType: "user", resourceId: user.id }, ctx);
    throw INVALID();
  }

  if (user.scope === "COMPANY") {
    const [company] = await db.select({ status: companies.status }).from(companies).where(eq(companies.id, user.companyId!));
    if (!company || BLOCKED_COMPANY_STATUSES.has(company.status)) {
      await db.insert(loginAttempts).values({ emailHash, ip, success: false });
      await writeAudit(db, { companyId: user.companyId, actorId: user.id, action: "auth.login_blocked_company", resourceType: "user", resourceId: user.id }, ctx);
      throw COMPANY_UNAVAILABLE();
    }
  }

  const actor = await loadActor(db, user.id, false);
  // Platform accounts and privileged company roles must always use MFA.
  const mfaRequired = user.mfaEnabled || user.scope === "PLATFORM" || [...(actor?.roles ?? [])].some((r) => MFA_REQUIRED_ROLES.has(r as RoleKey));

  const token = newToken();
  const expiresAt = new Date(now.getTime() + SESSION_ABSOLUTE_MS);
  await db.transaction(async (tx) => {
    await tx.update(users).set({ failedLoginCount: 0, lockedUntil: null, lastLoginAt: now }).where(eq(users.id, user.id));
    await tx.insert(sessions).values({ userId: user.id, tokenHash: hashToken(token), mfaVerified: !mfaRequired,
      expiresAt, ip, userAgent: ctx.userAgent?.slice(0, 512) ?? null });
    await tx.insert(loginAttempts).values({ emailHash, ip, success: true });
    await writeAudit(tx, { companyId: user.companyId, actorId: user.id, action: "auth.login", resourceType: "user", resourceId: user.id }, ctx);
  });
  return { token, expiresAt, mfaRequired, mfaEnrolmentRequired: mfaRequired && !user.mfaEnabled, mustChangePassword: !user.passwordChangedAt };
}

export interface SessionInfo { sessionId: string; actor: Actor; mfaVerified: boolean; companyStatus: string | null; passwordChangeRequired: boolean }

/** Resolves a raw cookie token to an actor. Enforces revocation, absolute expiry and idle timeout. */
export async function resolveSession(db: Db, token: string | undefined, now = new Date()): Promise<SessionInfo | null> {
  if (!token || token.length > 128) return null;
  const [row] = await db.select({ s: sessions, companyStatus: companies.status, companyId: users.companyId, scope: users.scope, passwordChangedAt: users.passwordChangedAt })
    .from(sessions).innerJoin(users, eq(users.id, sessions.userId)).leftJoin(companies, eq(companies.id, users.companyId))
    .where(eq(sessions.tokenHash, hashToken(token)));
  const s = row?.s;
  if (!row || !s || s.revokedAt || s.expiresAt <= now || now.getTime() - s.lastSeenAt.getTime() > SESSION_IDLE_MS) return null;
  // A suspended/expired company loses access immediately, even with a live session.
  if (row.scope === "COMPANY" && (!row.companyStatus || BLOCKED_COMPANY_STATUSES.has(row.companyStatus))) return null;
  const actor = await loadActor(db, s.userId, s.mfaVerified);
  if (!actor) return null;
  if (now.getTime() - s.lastSeenAt.getTime() > 60_000) {
    await db.update(sessions).set({ lastSeenAt: now }).where(eq(sessions.id, s.id));
  }
  // A user created directly by the platform with a temp password (passwordHash set, passwordChangedAt never set)
  // must choose their own password before doing anything else. Every other path sets both fields together.
  return { sessionId: s.id, actor, mfaVerified: s.mfaVerified, companyStatus: row.companyStatus ?? null, passwordChangeRequired: !row.passwordChangedAt };
}

/**
 * Completes a platform-assigned temp password: the caller already holds a valid, password-authenticated
 * session (checked by the route/page gate before this runs), so no token is needed here — only a fresh
 * password meeting policy. Always runs on the identity connection: pitch_app has no grant on password_hash.
 */
export async function completeRequiredPasswordChange(db: Db, actor: Actor, raw: unknown, ctx: RequestContext = {}): Promise<{ ok: true }> {
  const { password } = parseInput(z.object({ password: z.string().min(1).max(128) }).strict(), raw);
  return db.transaction(async (tx) => {
    const [u] = await tx.select({ id: users.id, email: users.email, fullName: users.fullName, passwordChangedAt: users.passwordChangedAt, companyId: users.companyId })
      .from(users).where(eq(users.id, actor.userId)).for("update");
    if (!u) throw new AppError("UNAUTHENTICATED", "Please sign in.");
    if (u.passwordChangedAt) throw new AppError("CONFLICT", "Your password has already been set. Use account settings to change it.");
    const errors = passwordPolicyErrors(password, { email: u.email, fullName: u.fullName });
    if (errors.length) throw new AppError("VALIDATION", errors.join(" "), { password: errors[0]! });
    await tx.update(users).set({ passwordHash: await hashPassword(password), passwordChangedAt: new Date(), failedLoginCount: 0, lockedUntil: null }).where(eq(users.id, u.id));
    await writeAudit(tx, { companyId: u.companyId, actorId: u.id, action: "auth.password_set_initial", resourceType: "user", resourceId: u.id }, ctx);
    return { ok: true };
  });
}

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(128),
  newPassword: z.string().min(1).max(128),
  code: z.string().regex(/^\d{6}$/, "Enter the 6-digit code."),
}).strict();

/**
 * Voluntary password change for an already-authenticated, MFA-verified session (any scope, including
 * Platform Super Admin). Requires re-proving both the current password and a fresh TOTP code — a
 * step-up check, since the session's own MFA verification could be minutes or hours old. On success,
 * every other session for this account is revoked; the caller's own session is left alone.
 */
export async function changeOwnPassword(db: Db, actor: Actor, sessionId: string, raw: unknown, ctx: RequestContext = {}, now = new Date()): Promise<{ ok: true }> {
  const { currentPassword, newPassword, code } = parseInput(changePasswordSchema, raw);
  return db.transaction(async (tx) => {
    const [u] = await tx.select({
      id: users.id, email: users.email, fullName: users.fullName, passwordHash: users.passwordHash,
      mfaEnabled: users.mfaEnabled, mfaSecretEnc: users.mfaSecretEnc, mfaLastStep: users.mfaLastStep, companyId: users.companyId,
    }).from(users).where(eq(users.id, actor.userId)).for("update");
    if (!u || !u.passwordHash) throw new AppError("UNAUTHENTICATED", "Please sign in.");

    const currentOk = await verifyPassword(u.passwordHash, currentPassword);
    if (!currentOk) throw new AppError("INVALID_CREDENTIALS", "Current password is incorrect.", { currentPassword: "Incorrect" });

    if (!u.mfaEnabled || !u.mfaSecretEnc) throw new AppError("MFA_REQUIRED", "Set up two-factor authentication before changing your password.");
    const step = verifyTotp(decryptSecret(u.mfaSecretEnc), code, now.getTime(), u.mfaLastStep);
    if (step === null) throw new AppError("VALIDATION", "That authenticator code is not valid.", { code: "Invalid" });

    const errors = passwordPolicyErrors(newPassword, { email: u.email, fullName: u.fullName });
    if (errors.length) throw new AppError("VALIDATION", errors.join(" "), { newPassword: errors[0]! });
    if (await verifyPassword(u.passwordHash, newPassword)) {
      throw new AppError("VALIDATION", "New password must be different from your current password.", { newPassword: "Reuse" });
    }

    await tx.update(users).set({ passwordHash: await hashPassword(newPassword), passwordChangedAt: now, mfaLastStep: step })
      .where(eq(users.id, u.id));
    await tx.update(sessions).set({ revokedAt: now })
      .where(and(eq(sessions.userId, u.id), isNull(sessions.revokedAt), ne(sessions.id, sessionId)));
    await writeAudit(tx, { companyId: u.companyId, actorId: u.id, action: "auth.password_changed", resourceType: "user", resourceId: u.id }, ctx);
    return { ok: true };
  });
}

export async function logout(db: Db, token: string | undefined, ctx: RequestContext = {}): Promise<void> {
  if (!token) return;
  const [s] = await db.update(sessions).set({ revokedAt: new Date() })
    .where(and(eq(sessions.tokenHash, hashToken(token)), isNull(sessions.revokedAt)))
    .returning({ userId: sessions.userId });
  if (!s) return;
  const [u] = await db.select({ companyId: users.companyId }).from(users).where(eq(users.id, s.userId));
  await writeAudit(db, { companyId: u?.companyId ?? null, actorId: s.userId, action: "auth.logout", resourceType: "user", resourceId: s.userId }, ctx);
}

/** Revoke every session for a user (password change, role change, disable). Works on either connection (RLS scopes pitch_app to its company). */
export async function revokeAllSessions(db: DbOrTx, userId: string): Promise<void> {
  await db.update(sessions).set({ revokedAt: new Date() }).where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)));
}
