import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/server/db/client";
import { sessions, users } from "@/server/db/schema";
import { AppError } from "@/server/lib/errors";
import { writeAudit, type RequestContext } from "@/server/modules/audit/service";
import { decryptSecret, encryptSecret, newTotpSecret, otpauthUri, verifyTotp } from "./totp";

export const codeSchema = z.object({ code: z.string().regex(/^\d{6}$/) }).strict();

/* Runs on the identity connection (getPlatformDb()). */
const companyOf = async (db: Db, userId: string) =>
  (await db.select({ companyId: users.companyId }).from(users).where(eq(users.id, userId)))[0]?.companyId ?? null;

/** Step 1 of enrolment: generate a pending secret. Requires a password-authenticated session. */
export async function beginEnrolment(db: Db, userId: string, ctx: RequestContext = {}) {
  const [u] = await db.select({ email: users.email, mfaEnabled: users.mfaEnabled }).from(users).where(eq(users.id, userId));
  if (!u) throw new AppError("UNAUTHENTICATED", "Please sign in.");
  if (u.mfaEnabled) throw new AppError("CONFLICT", "Two-factor authentication is already enabled.");
  const secret = newTotpSecret();
  await db.update(users).set({ mfaPendingSecretEnc: encryptSecret(secret) }).where(eq(users.id, userId));
  await writeAudit(db, { companyId: await companyOf(db, userId), actorId: userId, action: "auth.mfa_enrolment_started", resourceType: "user", resourceId: userId }, ctx);
  return { otpauthUri: otpauthUri(secret, u.email) };
}

/** Step 2: confirm with a code; enables MFA and marks the current session verified. */
export async function confirmEnrolment(db: Db, userId: string, sessionId: string, raw: unknown, ctx: RequestContext = {}, now = Date.now()) {
  const { code } = parseCode(raw);
  const [u] = await db.select({ pending: users.mfaPendingSecretEnc }).from(users).where(eq(users.id, userId));
  if (!u?.pending) throw new AppError("VALIDATION", "Start enrolment first.");
  const step = verifyTotp(decryptSecret(u.pending), code, now);
  if (step === null) throw new AppError("VALIDATION", "That code is not valid.", { code: "Invalid" });
  const companyId = await companyOf(db, userId);
  await db.transaction(async (tx) => {
    await tx.update(users).set({ mfaSecretEnc: u.pending, mfaPendingSecretEnc: null, mfaEnabled: true, mfaLastStep: step }).where(eq(users.id, userId));
    await tx.update(sessions).set({ mfaVerified: true }).where(eq(sessions.id, sessionId));
    await writeAudit(tx, { companyId, actorId: userId, action: "auth.mfa_enabled", resourceType: "user", resourceId: userId }, ctx);
  });
}

/** Verify a code for a session created by password login. */
export async function verifySessionMfa(db: Db, userId: string, sessionId: string, raw: unknown, ctx: RequestContext = {}, now = Date.now()) {
  const { code } = parseCode(raw);
  const [u] = await db.select({ secret: users.mfaSecretEnc, enabled: users.mfaEnabled, last: users.mfaLastStep }).from(users).where(eq(users.id, userId));
  if (!u?.enabled || !u.secret) throw new AppError("MFA_REQUIRED", "Set up two-factor authentication to continue.");
  const step = verifyTotp(decryptSecret(u.secret), code, now, u.last);
  const companyId = await companyOf(db, userId);
  if (step === null) {
    await writeAudit(db, { companyId, actorId: userId, action: "auth.mfa_failed", resourceType: "user", resourceId: userId }, ctx);
    throw new AppError("VALIDATION", "That code is not valid.", { code: "Invalid" });
  }
  await db.transaction(async (tx) => {
    await tx.update(users).set({ mfaLastStep: step }).where(eq(users.id, userId));
    await tx.update(sessions).set({ mfaVerified: true }).where(and(eq(sessions.id, sessionId), isNull(sessions.revokedAt)));
    await writeAudit(tx, { companyId, actorId: userId, action: "auth.mfa_verified", resourceType: "user", resourceId: userId }, ctx);
  });
}

function parseCode(raw: unknown) {
  const p = codeSchema.safeParse(raw);
  if (!p.success) throw new AppError("VALIDATION", "Enter the 6-digit code.", { code: "Invalid" });
  return p.data;
}
