/**
 * Platform-wide creator accounts: anyone can register with a mobile number proved by a WhatsApp code. No password,
 * no email, no company. Runs on the identity connection (getPlatformDb()) — these tables are invisible to the
 * company role. A creator can never become a staff session or the other way round: separate tables, cookie and resolver.
 */
import { and, eq, gt, isNull } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/server/db/client";
import { loginOtps, publicCreatorSessions, publicCreators } from "@/server/db/schema";
import { AppError } from "@/server/lib/errors";
import { parseInput } from "@/server/lib/validation";
import { writeAudit, type RequestContext } from "@/server/modules/audit/service";
import { BAD_CODE, OTP_TTL_MS, checkCode, deliverCode, issueCode, validMobile } from "@/server/modules/auth/otp";
import { hashIdentifier, hashToken, newToken, safeEqual } from "@/server/modules/auth/tokens";

export const CREATOR_TYPES = ["WRITER", "DIRECTOR", "WRITER_DIRECTOR", "PRODUCER", "CREATOR", "OTHER"] as const;
export const CREATOR_SESSION_ABSOLUTE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days — an occasional-use identity, like the company portal
export const CREATOR_SESSION_IDLE_MS = 7 * 24 * 60 * 60 * 1000;      // 7 days

const scope = (e164: string) => `public:${e164}`;

const requestSchema = z.object({ mobile: z.string().trim().min(5).max(24) }).strict();
const verifySchema = z.object({ mobile: z.string().trim().min(5).max(24), code: z.string().trim().regex(/^\d{6}$/) }).strict();
const registerSchema = z.object({
  mobile: z.string().trim().min(5).max(24),
  profileToken: z.string().min(20).max(128),
  fullName: z.string().trim().min(2).max(120),
  creatorType: z.enum(CREATOR_TYPES),
}).strict();

export interface PublicSession { token: string; expiresAt: Date }
export type PublicVerifyResult = ({ kind: "session" } & PublicSession) | { kind: "profile"; profileToken: string };

async function startSession(db: Db, creatorId: string, ctx: RequestContext, now: Date): Promise<PublicSession> {
  const token = newToken();
  const expiresAt = new Date(now.getTime() + CREATOR_SESSION_ABSOLUTE_MS);
  await db.insert(publicCreatorSessions).values({ creatorId, tokenHash: hashToken(token), expiresAt, ip: ctx.ip ?? null, userAgent: ctx.userAgent?.slice(0, 512) ?? null });
  await db.update(publicCreators).set({ lastLoginAt: now }).where(eq(publicCreators.id, creatorId));
  return { token, expiresAt };
}

/** Sends a code to any valid mobile number — registration and sign-in are the same first step. */
export async function requestPublicOtp(db: Db, raw: unknown, ctx: RequestContext = {}, now = new Date()): Promise<{ sent: true }> {
  const { mobile } = parseInput(requestSchema, raw);
  const e164 = validMobile(mobile);
  const code = await issueCode(db, scope(e164), ctx, now);
  await deliverCode(e164, code);
  return { sent: true };
}

/** Existing creator → a session. New number → a one-time profile token to finish registering with. */
export async function verifyPublicOtp(db: Db, raw: unknown, ctx: RequestContext = {}, now = new Date()): Promise<PublicVerifyResult> {
  const { mobile, code } = parseInput(verifySchema, raw);
  const e164 = validMobile(mobile);
  const otpId = await checkCode(db, scope(e164), code, ctx, now);
  const [creator] = await db.select().from(publicCreators).where(eq(publicCreators.mobileE164, e164));
  if (creator) {
    if (creator.disabledAt) throw new AppError("ACCOUNT_LOCKED", "This account has been disabled.");
    await db.update(loginOtps).set({ verifiedAt: now, consumedAt: now }).where(eq(loginOtps.id, otpId));
    await writeAudit(db, { actorId: null, action: "creator.login", resourceType: "public_creator", resourceId: creator.id }, ctx);
    return { kind: "session", ...(await startSession(db, creator.id, ctx, now)) };
  }
  const profileToken = newToken();
  await db.update(loginOtps).set({ verifiedAt: now, choiceTokenHash: hashToken(profileToken), choiceExpiresAt: new Date(now.getTime() + OTP_TTL_MS) }).where(eq(loginOtps.id, otpId));
  return { kind: "profile", profileToken };
}

/** Finishes registration. The number comes from the verified code (bound to the token), never trusted from the form alone. */
export async function registerPublicCreator(db: Db, raw: unknown, ctx: RequestContext = {}, now = new Date()): Promise<PublicSession> {
  const input = parseInput(registerSchema, raw);
  const e164 = validMobile(input.mobile);
  const [otp] = await db.update(loginOtps).set({ consumedAt: now })
    .where(and(eq(loginOtps.choiceTokenHash, hashToken(input.profileToken)), isNull(loginOtps.consumedAt), gt(loginOtps.choiceExpiresAt, now))).returning();
  if (!otp || !safeEqual(hashIdentifier(scope(e164)).toString("hex"), otp.mobileHash.toString("hex"))) throw BAD_CODE();
  const id = crypto.randomUUID();
  try {
    await db.insert(publicCreators).values({ id, mobileE164: e164, fullName: input.fullName, creatorType: input.creatorType });
  } catch (e) {
    if ((e as { cause?: { code?: string } })?.cause?.code === "23505") throw new AppError("CONFLICT", "This number is already registered. Sign in instead.");
    throw e;
  }
  await writeAudit(db, { actorId: null, action: "creator.registered", resourceType: "public_creator", resourceId: id }, ctx);
  return startSession(db, id, ctx, now);
}

export interface PublicCreatorSession { creatorId: string; sessionId: string; fullName: string; mobileE164: string; creatorType: string }

export async function resolvePublicSession(db: Db, token: string | undefined, now = new Date()): Promise<PublicCreatorSession | null> {
  if (!token || token.length > 128) return null;
  const [row] = await db.select({ s: publicCreatorSessions, c: publicCreators }).from(publicCreatorSessions)
    .innerJoin(publicCreators, eq(publicCreators.id, publicCreatorSessions.creatorId)).where(eq(publicCreatorSessions.tokenHash, hashToken(token)));
  if (!row || row.s.revokedAt || row.s.expiresAt <= now || row.c.disabledAt) return null;
  if (now.getTime() - row.s.lastSeenAt.getTime() > CREATOR_SESSION_IDLE_MS) return null;
  if (now.getTime() - row.s.lastSeenAt.getTime() > 60_000) await db.update(publicCreatorSessions).set({ lastSeenAt: now }).where(eq(publicCreatorSessions.id, row.s.id));
  return { creatorId: row.c.id, sessionId: row.s.id, fullName: row.c.fullName, mobileE164: row.c.mobileE164, creatorType: row.c.creatorType };
}

export async function logoutPublicCreator(db: Db, token: string | undefined): Promise<void> {
  if (!token) return;
  await db.update(publicCreatorSessions).set({ revokedAt: new Date() }).where(and(eq(publicCreatorSessions.tokenHash, hashToken(token)), isNull(publicCreatorSessions.revokedAt)));
}
