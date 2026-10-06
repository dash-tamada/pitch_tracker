import { NextResponse } from "next/server";
import { getPlatformDb } from "@/server/db/client";
import { readJson, route, SESSION_COOKIE, sessionCookieOptions } from "@/server/lib/http";
import { chooseOtpAccount } from "@/server/modules/auth/otp";

export const POST = route({ auth: false, rateLimit: { limit: 10, windowMs: 60_000 } }, async ({ req, ctx }) => {
  const r = await chooseOtpAccount(getPlatformDb(), await readJson(req), ctx);
  const res = NextResponse.json({ mfaRequired: r.mfaRequired, mfaEnrolmentRequired: r.mfaEnrolmentRequired, mustChangePassword: r.mustChangePassword });
  res.cookies.set(SESSION_COOKIE(), r.token, sessionCookieOptions(r.expiresAt));
  return res;
});
