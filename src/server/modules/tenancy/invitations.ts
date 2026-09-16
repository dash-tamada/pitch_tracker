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
import { companies, companyAllowedEmails, companyEmailDomains, jobOutbox, sessions, userInvitations, users } from "@/server/db/schema";
import { AppError } from "@/server/lib/errors";
import { parseInput } from "@/server/lib/validation";
import { writeAudit, type RequestContext } from "@/server/modules/audit/service";
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
