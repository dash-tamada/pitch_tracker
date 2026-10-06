/**
 * Employee invitations and the company email policy.
 *
 *  - An email may join a company only if its domain is on the company's allowed-domain list (set by the platform)
 *    or the exact address is on the company's exception list (added by a Company Admin, with a reason, audited).
 *  - An invitation is a random 256-bit token; only its HMAC hash is stored. It expires after 72 hours, can be used once,
 *    and is revoked when a new one is issued. The raw token is returned once to the inviting admin and/or queued for email,
 *    and the email payload is cleared once sent. Passwords are never chosen by, sent to or visible to an admin.
 *  - Accepting runs on the identity connection (no session exists yet) and re-checks company status.
 */
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import type { Db, DbOrTx } from "@/server/db/client";
import { companies, companyAllowedEmails, companyEmailDomains, jobOutbox, loginOtps, sessions, userInvitations, users } from "@/server/db/schema";
import { AppError } from "@/server/lib/errors";
import { normalizeMobile } from "@/server/lib/pii";
import { parseInput } from "@/server/lib/validation";
import { writeAudit, type RequestContext } from "@/server/modules/audit/service";
import { BAD_CODE, checkCode, deliverCode, issueCode, validMobile } from "@/server/modules/auth/otp";
import { hashPassword, passwordPolicyErrors } from "@/server/modules/auth/password";
import { BLOCKED_COMPANY_STATUSES } from "@/server/modules/auth/service";
import { hashToken, newToken } from "@/server/modules/auth/tokens";

export const INVITATION_TTL_MS = 72 * 3600_000;

export function emailDomain(email: string): string {
  return email.slice(email.lastIndexOf("@") + 1).toLowerCase();
}

/** Backend enforcement of the company email policy. `db` is company-scoped, so only this company's lists are visible. */
export async function assertEmailAllowed(db: DbOrTx, email: string): Promise<void> {
  const normalized = email.trim().toLowerCase();
  const [domain] = await db.select({ d: companyEmailDomains.domain }).from(companyEmailDomains).where(eq(companyEmailDomains.domain, emailDomain(normalized)));
  if (domain) return;
  const [exact] = await db.select({ e: companyAllowedEmails.email }).from(companyAllowedEmails).where(eq(companyAllowedEmails.email, normalized));
  if (exact) return;
  throw new AppError("VALIDATION", "This email address is not allowed for your company. Use a company email address or ask your Company Admin to add an exception.", { email: "Not allowed" });
}

/** Revokes older invitations for the user and issues a new one. Returns the raw token (caller decides how to deliver it). */
export async function issueInvitation(tx: DbOrTx, userId: string, invitedById: string | null): Promise<string> {
  await tx.update(userInvitations).set({ revokedAt: new Date() })
    .where(and(eq(userInvitations.userId, userId), isNull(userInvitations.usedAt), isNull(userInvitations.revokedAt)));
  const token = newToken();
  await tx.insert(userInvitations).values({ userId, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + INVITATION_TTL_MS), invitedById });
  // The email worker sends the link and then removes the token from the payload.
  await tx.insert(jobOutbox).values({ type: "EMAIL_INVITATION", payload: { userId, token } });
  return token;
}

export const acceptInvitationSchema = z.object({ token: z.string().min(20).max(128), password: z.string().min(1).max(128) }).strict();

/** Identity connection (getPlatformDb()). Same message for every failure so tokens cannot be probed. */
export async function acceptInvitation(platformDb: Db, raw: unknown, ctx: RequestContext = {}) {
  const { token, password } = parseInput(acceptInvitationSchema, raw);
  const invalid = () => new AppError("VALIDATION", "This invitation is invalid or has expired. Ask your Company Admin for a new one.");
  return platformDb.transaction(async (tx) => {
    const [inv] = await tx.select().from(userInvitations).where(eq(userInvitations.tokenHash, hashToken(token))).for("update");
    if (!inv || inv.usedAt || inv.revokedAt || inv.expiresAt <= new Date()) throw invalid();
    const [u] = await tx.select({ id: users.id, email: users.email, fullName: users.fullName, status: users.status, companyId: users.companyId })
      .from(users).where(eq(users.id, inv.userId)).for("update");
    if (!u || u.companyId !== inv.companyId || u.status !== "INVITED") throw invalid();
    const [company] = await tx.select({ status: companies.status }).from(companies).where(eq(companies.id, inv.companyId));
    if (!company || BLOCKED_COMPANY_STATUSES.has(company.status)) throw new AppError("COMPANY_UNAVAILABLE", "Your company's account is not active. Please contact your company administrator.");
    const errors = passwordPolicyErrors(password, { email: u.email, fullName: u.fullName });
    if (errors.length) throw new AppError("VALIDATION", errors.join(" "), { password: errors[0]! });
    await tx.update(userInvitations).set({ usedAt: new Date() }).where(eq(userInvitations.id, inv.id));
    await tx.update(users).set({ passwordHash: await hashPassword(password), passwordChangedAt: new Date(), status: "ACTIVE", failedLoginCount: 0, lockedUntil: null })
      .where(eq(users.id, u.id));
    await tx.update(sessions).set({ revokedAt: new Date() }).where(and(eq(sessions.userId, u.id), isNull(sessions.revokedAt)));
    await writeAudit(tx, { companyId: inv.companyId, actorId: u.id, action: "auth.invitation_accepted", resourceType: "user", resourceId: u.id }, ctx);
    return { ok: true };
  });
}

/*
 * Accepting by WhatsApp: the invited person proves they hold a mobile number with a one-time code instead of choosing a
 * password. The number is saved on their account and becomes how they sign in. The password path above stays for the API.
 * The code is bound to this invitation AND this number, so it cannot be reused for anything else.
 */
const inviteScope = (invitationId: string, e164: string) => `invite:${invitationId}:${e164}`;
export const inviteOtpRequestSchema = z.object({ token: z.string().min(20).max(128), mobile: z.string().trim().min(5).max(24) }).strict();
export const acceptByOtpSchema = z.object({ token: z.string().min(20).max(128), mobile: z.string().trim().min(5).max(24), code: z.string().trim().regex(/^\d{6}$/) }).strict();

async function liveInvitation(db: Db, token: string) {
  const invalid = () => new AppError("VALIDATION", "This invitation is invalid or has expired. Ask your Company Admin for a new one.");
  const [inv] = await db.select().from(userInvitations).where(eq(userInvitations.tokenHash, hashToken(token)));
  if (!inv || inv.usedAt || inv.revokedAt || inv.expiresAt <= new Date()) throw invalid();
  const [u] = await db.select({ id: users.id, status: users.status, companyId: users.companyId }).from(users).where(eq(users.id, inv.userId));
  if (!u || u.companyId !== inv.companyId || u.status !== "INVITED") throw invalid();
  const [company] = await db.select({ status: companies.status }).from(companies).where(eq(companies.id, inv.companyId));
  if (!company || BLOCKED_COMPANY_STATUSES.has(company.status)) throw new AppError("COMPANY_UNAVAILABLE", "Your company's account is not active. Please contact your company administrator.");
  return inv;
}

/** Identity connection. Sends the code to the number the invitee entered. */
export async function requestInvitationOtp(platformDb: Db, raw: unknown, ctx: RequestContext = {}, now = new Date()) {
  const { token, mobile } = parseInput(inviteOtpRequestSchema, raw);
  const e164 = validMobile(mobile);
  const inv = await liveInvitation(platformDb, token);
  await deliverCode(platformDb, e164, await issueCode(platformDb, inviteScope(inv.id, e164), ctx, now));
  await writeAudit(platformDb, { companyId: inv.companyId, actorId: null, action: "auth.invitation_otp_requested", resourceType: "user", resourceId: inv.userId }, ctx);
  return { sent: true as const };
}

/** Identity connection. Verifies the code, saves the number, activates the account. They then sign in with a fresh code. */
export async function acceptInvitationByOtp(platformDb: Db, raw: unknown, ctx: RequestContext = {}, now = new Date()) {
  const { token, mobile, code } = parseInput(acceptByOtpSchema, raw);
  const e164 = normalizeMobile(mobile);
  if (!e164) throw BAD_CODE();
  const inv = await liveInvitation(platformDb, token);
  const otpId = await checkCode(platformDb, inviteScope(inv.id, e164), code, ctx, now);
  return platformDb.transaction(async (tx) => {
    // Re-check under lock so two parallel accepts cannot both succeed.
    const [locked] = await tx.select().from(userInvitations).where(eq(userInvitations.id, inv.id)).for("update");
    if (!locked || locked.usedAt || locked.revokedAt) throw new AppError("VALIDATION", "This invitation is invalid or has expired. Ask your Company Admin for a new one.");
    await tx.update(loginOtps).set({ verifiedAt: now, consumedAt: now }).where(eq(loginOtps.id, otpId));
    await tx.update(userInvitations).set({ usedAt: now }).where(eq(userInvitations.id, inv.id));
    await tx.update(users).set({ mobileE164: e164, status: "ACTIVE", failedLoginCount: 0, lockedUntil: null }).where(eq(users.id, inv.userId));
    await tx.update(sessions).set({ revokedAt: now }).where(and(eq(sessions.userId, inv.userId), isNull(sessions.revokedAt)));
    await writeAudit(tx, { companyId: inv.companyId, actorId: inv.userId, action: "auth.invitation_accepted", resourceType: "user", resourceId: inv.userId, after: { method: "whatsapp" } }, ctx);
    return { ok: true as const };
  });
}
