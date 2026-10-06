import { randomInt } from "node:crypto";
import { and, desc, eq, gt, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/server/db/client";
import { companies, loginOtps, users } from "@/server/db/schema";
import { AppError } from "@/server/lib/errors";
import { maskEmail, normalizeMobile } from "@/server/lib/pii";
import { parseInput } from "@/server/lib/validation";
import { writeAudit, type RequestContext } from "@/server/modules/audit/service";
import { BLOCKED_COMPANY_STATUSES, issueSession, type LoginResult } from "./service";
import { hashIdentifier, hashToken, newToken, safeEqual } from "./tokens";
import { sendWhatsappOtp } from "./whatsapp";

/*
 * Sign in with a mobile number and a WhatsApp one-time code. Runs on the identity connection like the rest of sign-in.
 * Platform (Super Admin) accounts are never eligible. A code proves the person holds the phone; it is not a
 * second factor on top of anything, so privileged roles still complete TOTP afterwards (issueSession decides).
 */
export const OTP_TTL_MS = 5 * 60 * 1000;
export const OTP_MAX_ATTEMPTS = 5;
export const OTP_RESEND_COOLDOWN_MS = 30 * 1000;
const PER_MOBILE_PER_HOUR = 5;
const PER_IP_PER_HOUR = 20;
const HOUR = 60 * 60 * 1000;

const BAD_CODE = () => new AppError("INVALID_CREDENTIALS", "That code is incorrect or has expired. Request a new one.");

const mobileSchema = z.object({ mobile: z.string().trim().min(5).max(24) }).strict();
const verifySchema = z.object({ mobile: z.string().trim().min(5).max(24), code: z.string().trim().regex(/^\d{6}$/) }).strict();
const chooseSchema = z.object({ choiceToken: z.string().min(20).max(128), userId: z.uuid() }).strict();

export interface AccountChoice { userId: string; company: string; name: string; email: string }
export type OtpVerifyResult = ({ kind: "session" } & LoginResult) | { kind: "choose"; choiceToken: string; accounts: AccountChoice[] };

const codeHash = (otpId: string, code: string) => hashToken(`otp:${otpId}:${code}`);

/** Active company accounts that own this number. Platform admins, archived, disabled and blocked-company users are out. */
async function eligibleAccounts(db: Db, e164: string) {
  const rows = await db.select({ u: users, companyName: companies.name, companyStatus: companies.status })
    .from(users).innerJoin(companies, eq(companies.id, users.companyId))
    .where(and(eq(users.mobileE164, e164), eq(users.scope, "COMPANY"), eq(users.status, "ACTIVE"), isNull(users.archivedAt), isNull(users.disabledAt)));
  return rows.filter((r) => !BLOCKED_COMPANY_STATUSES.has(r.companyStatus));
}

/** Always resolves the same way whether or not the number is registered, so it cannot be used to find out who has an account. */
export async function requestOtp(db: Db, raw: unknown, ctx: RequestContext = {}, now = new Date()): Promise<{ sent: true }> {
  const { mobile } = parseInput(mobileSchema, raw);
  const e164 = normalizeMobile(mobile);
  if (!e164) throw new AppError("VALIDATION", "Enter a valid mobile number.", { mobile: "Not a valid number" });
  const mobileHash = hashIdentifier(e164);
  const ip = ctx.ip ?? null;
  const since = new Date(now.getTime() - HOUR);

  const [{ m } = { m: 0 }] = await db.select({ m: sql<number>`count(*)::int` }).from(loginOtps).where(and(eq(loginOtps.mobileHash, mobileHash), gt(loginOtps.createdAt, since)));
  if (m >= PER_MOBILE_PER_HOUR) throw new AppError("RATE_LIMITED", "Too many codes requested. Please wait and try again.");
  if (ip) {
    const [{ n } = { n: 0 }] = await db.select({ n: sql<number>`count(*)::int` }).from(loginOtps).where(and(eq(loginOtps.ip, ip), gt(loginOtps.createdAt, since)));
    if (n >= PER_IP_PER_HOUR) throw new AppError("RATE_LIMITED", "Too many attempts. Please wait and try again.");
  }
  const [last] = await db.select({ at: loginOtps.createdAt }).from(loginOtps).where(eq(loginOtps.mobileHash, mobileHash)).orderBy(desc(loginOtps.createdAt)).limit(1);
  if (last && now.getTime() - last.at.getTime() < OTP_RESEND_COOLDOWN_MS) throw new AppError("RATE_LIMITED", "Please wait a few seconds before asking for another code.");

  const accounts = await eligibleAccounts(db, e164);
  // The row (and its rate-limit footprint) is written for unknown numbers too, so the two cases look identical from outside.
  const id = crypto.randomUUID();
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  await db.insert(loginOtps).values({ id, mobileHash, codeHash: codeHash(id, code), ip, expiresAt: new Date(now.getTime() + OTP_TTL_MS) });
  if (accounts.length > 0) {
    try { await sendWhatsappOtp(e164, code); }
    catch (err) { console.error(JSON.stringify({ level: "error", route: "whatsapp-otp", message: err instanceof Error ? err.message.slice(0, 200) : "send failed" })); }
    await writeAudit(db, { companyId: accounts.length === 1 ? accounts[0]!.u.companyId : null, actorId: null, action: "auth.otp_requested", resourceType: "auth" }, ctx);
  }
  return { sent: true };
}

export async function verifyOtp(db: Db, raw: unknown, ctx: RequestContext = {}, now = new Date()): Promise<OtpVerifyResult> {
  const { mobile, code } = parseInput(verifySchema, raw);
  const e164 = normalizeMobile(mobile);
  if (!e164) throw BAD_CODE();
  const mobileHash = hashIdentifier(e164);

  const [otp] = await db.select().from(loginOtps)
    .where(and(eq(loginOtps.mobileHash, mobileHash), isNull(loginOtps.verifiedAt), gt(loginOtps.expiresAt, now)))
    .orderBy(desc(loginOtps.createdAt)).limit(1);
  if (!otp || otp.attempts >= OTP_MAX_ATTEMPTS) throw BAD_CODE();
  // Count the try before comparing, so parallel guesses cannot beat the limit.
  const [bumped] = await db.update(loginOtps).set({ attempts: sql`${loginOtps.attempts} + 1` })
    .where(and(eq(loginOtps.id, otp.id), sql`${loginOtps.attempts} < ${OTP_MAX_ATTEMPTS}`)).returning({ attempts: loginOtps.attempts });
  if (!bumped) throw BAD_CODE();
  if (!safeEqual(codeHash(otp.id, code).toString("hex"), otp.codeHash.toString("hex"))) {
    await writeAudit(db, { actorId: null, action: "auth.otp_failed", resourceType: "auth" }, ctx);
    throw BAD_CODE();
  }

  const accounts = await eligibleAccounts(db, e164);
  if (accounts.length === 0) throw BAD_CODE();
  if (accounts.length === 1) {
    await db.update(loginOtps).set({ verifiedAt: now, consumedAt: now }).where(eq(loginOtps.id, otp.id));
    const u = accounts[0]!.u;
    return { kind: "session", ...(await issueSession(db, u, { emailHash: hashIdentifier(u.email), ip: ctx.ip ?? null }, ctx, now)) };
  }
  // More than one account on this number: the code is proven, now let the person pick one.
  const choiceToken = newToken();
  await db.update(loginOtps).set({ verifiedAt: now, choiceTokenHash: hashToken(choiceToken), choiceExpiresAt: new Date(now.getTime() + OTP_TTL_MS) }).where(eq(loginOtps.id, otp.id));
  return { kind: "choose", choiceToken, accounts: accounts.map((a) => ({ userId: a.u.id, company: a.companyName, name: a.u.fullName, email: maskEmail(a.u.email) ?? "" })) };
}

export async function chooseOtpAccount(db: Db, raw: unknown, ctx: RequestContext = {}, now = new Date()): Promise<LoginResult> {
  const { choiceToken, userId } = parseInput(chooseSchema, raw);
  // Single use: claiming the row and consuming it is one statement.
  const [otp] = await db.update(loginOtps).set({ consumedAt: now })
    .where(and(eq(loginOtps.choiceTokenHash, hashToken(choiceToken)), isNull(loginOtps.consumedAt), gt(loginOtps.choiceExpiresAt, now))).returning();
  if (!otp) throw BAD_CODE();
  const [user] = await db.select({ mobile: users.mobileE164 }).from(users).where(eq(users.id, userId));
  if (!user?.mobile || !safeEqual(hashIdentifier(user.mobile).toString("hex"), otp.mobileHash.toString("hex"))) throw BAD_CODE();
  const account = (await eligibleAccounts(db, user.mobile)).find((a) => a.u.id === userId);
  if (!account) throw BAD_CODE();
  return issueSession(db, account.u, { emailHash: hashIdentifier(account.u.email), ip: ctx.ip ?? null }, ctx, now);
}
