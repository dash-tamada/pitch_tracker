import { NextResponse } from "next/server";
import { getPlatformDb } from "@/server/db/client";
import { readJson, route, SESSION_COOKIE, sessionCookieOptions } from "@/server/lib/http";
import { login } from "@/server/modules/auth/service";

export const POST = route({ auth: false, rateLimit: { limit: 10, windowMs: 60_000 } }, async ({ req, ctx }) => {
  const result = await login(getPlatformDb(), await readJson(req), ctx);
  const res = NextResponse.json({ mfaRequired: result.mfaRequired, mfaEnrolmentRequired: result.mfaEnrolmentRequired, mustChangePassword: result.mustChangePassword });
  res.cookies.set(SESSION_COOKIE(), result.token, sessionCookieOptions(result.expiresAt));
  return res;
});
