/**
 * Platform-wide creator accounts. A writer signs up once with a mobile number proved by a WhatsApp code plus their profile
 * (this file); after that they sign in on the SAME login page as staff (auth/otp.ts decides which account a verified number
 * opens). No password, no email, no company. Runs on the identity connection (getPlatformDb()) — these tables are invisible
 * to the company role. A writer can never become a staff session or the other way round: separate tables, cookie, resolver.
 */
import { and, eq, gt, isNull } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/server/db/client";
import { loginOtps, publicCreatorCredits, publicCreatorSessions, publicCreators } from "@/server/db/schema";
import { AppError } from "@/server/lib/errors";
import { parseInput } from "@/server/lib/validation";
import { writeAudit, type RequestContext } from "@/server/modules/audit/service";
import { BAD_CODE, OTP_TTL_MS, checkCode, deliverCode, issueCode, validMobile } from "@/server/modules/auth/otp";
import { hashIdentifier, hashToken, newToken, safeEqual } from "@/server/modules/auth/tokens";
import { CREATOR_TYPES, creditRows, detailColumns, detailsSchema } from "./profile";
import { CREATOR_SESSION_IDLE_MS, startPublicSession, type PublicSession } from "./session";

export { CREATOR_TYPES };
export type { PublicSession };

const scope = (e164: string) => `public:${e164}`;
const ALREADY = () => new AppError("CONFLICT", "This number is already registered. Please sign in from the login page.");

const requestSchema = z.object({ mobile: z.string().trim().min(5).max(24) }).strict();
const verifySchema = z.object({ mobile: z.string().trim().min(5).max(24), code: z.string().trim().regex(/^\d{6}$/) }).strict();
const registerSchema = detailsSchema.extend({ mobile: z.string().trim().min(5).max(24), profileToken: z.string().min(20).max(128) }).strict();

export type PublicVerifyResult = { kind: "profile"; profileToken: string };

async function existing(db: Db, e164: string) {
  const [c] = await db.select({ id: publicCreators.id }).from(publicCreators).where(eq(publicCreators.mobileE164, e164));
  return c;
}

/** Sign-up, step 1: a code to the number. A number that already has a writer account is sent to the login page instead. */
export async function requestPublicOtp(db: Db, raw: unknown, ctx: RequestContext = {}, now = new Date()): Promise<{ sent: true }> {
  const { mobile } = parseInput(requestSchema, raw);
  const e164 = validMobile(mobile);
  if (await existing(db, e164)) throw ALREADY();
  await deliverCode(db, e164, await issueCode(db, scope(e164), ctx, now));
  return { sent: true };
}

/** Sign-up, step 2: the code proves the phone; hand back a one-time token to finish the profile with. */
export async function verifyPublicOtp(db: Db, raw: unknown, ctx: RequestContext = {}, now = new Date()): Promise<PublicVerifyResult> {
  const { mobile, code } = parseInput(verifySchema, raw);
  const e164 = validMobile(mobile);
  const otpId = await checkCode(db, scope(e164), code, ctx, now);
  if (await existing(db, e164)) throw ALREADY();
  const profileToken = newToken();
  await db.update(loginOtps).set({ verifiedAt: now, choiceTokenHash: hashToken(profileToken), choiceExpiresAt: new Date(now.getTime() + OTP_TTL_MS) }).where(eq(loginOtps.id, otpId));
  return { kind: "profile", profileToken };
}

/** Sign-up, step 3: the profile. The number comes from the verified code (bound to the token), never trusted from the form alone. */
export async function registerPublicCreator(db: Db, raw: unknown, ctx: RequestContext = {}, now = new Date()): Promise<PublicSession> {
  const input = parseInput(registerSchema, raw);
  const e164 = validMobile(input.mobile);
  const [otp] = await db.update(loginOtps).set({ consumedAt: now })
    .where(and(eq(loginOtps.choiceTokenHash, hashToken(input.profileToken)), isNull(loginOtps.consumedAt), gt(loginOtps.choiceExpiresAt, now))).returning();
  if (!otp || !safeEqual(hashIdentifier(scope(e164)).toString("hex"), otp.mobileHash.toString("hex"))) throw BAD_CODE();
  const id = crypto.randomUUID();
  try {
    await db.transaction(async (tx) => {
      await tx.insert(publicCreators).values({ id, mobileE164: e164, ...detailColumns(input) });
      if (input.credits.length) await tx.insert(publicCreatorCredits).values(creditRows(id, input));
    });
  } catch (e) {
    if ((e as { cause?: { code?: string } })?.cause?.code === "23505") throw ALREADY();
    throw e;
  }
  await writeAudit(db, { actorId: null, action: "creator.registered", resourceType: "public_creator", resourceId: id }, ctx);
  return startPublicSession(db, id, ctx, now);
}

export interface PublicCreatorSession {
  creatorId: string; sessionId: string; fullName: string; mobileE164: string; creatorType: string;
  /** The studio opens only once a profile photo has been added. */
  hasPhoto: boolean;
}

export async function resolvePublicSession(db: Db, token: string | undefined, now = new Date()): Promise<PublicCreatorSession | null> {
  if (!token || token.length > 128) return null;
  const [row] = await db.select({ s: publicCreatorSessions, c: publicCreators }).from(publicCreatorSessions)
    .innerJoin(publicCreators, eq(publicCreators.id, publicCreatorSessions.creatorId)).where(eq(publicCreatorSessions.tokenHash, hashToken(token)));
  if (!row || row.s.revokedAt || row.s.expiresAt <= now || row.c.disabledAt) return null;
  if (now.getTime() - row.s.lastSeenAt.getTime() > CREATOR_SESSION_IDLE_MS) return null;
  if (now.getTime() - row.s.lastSeenAt.getTime() > 60_000) await db.update(publicCreatorSessions).set({ lastSeenAt: now }).where(eq(publicCreatorSessions.id, row.s.id));
  return { creatorId: row.c.id, sessionId: row.s.id, fullName: row.c.fullName, mobileE164: row.c.mobileE164, creatorType: row.c.creatorType, hasPhoto: Boolean(row.c.profileImageKey) };
}

export async function logoutPublicCreator(db: Db, token: string | undefined): Promise<void> {
  if (!token) return;
  await db.update(publicCreatorSessions).set({ revokedAt: new Date() }).where(and(eq(publicCreatorSessions.tokenHash, hashToken(token)), isNull(publicCreatorSessions.revokedAt)));
}
