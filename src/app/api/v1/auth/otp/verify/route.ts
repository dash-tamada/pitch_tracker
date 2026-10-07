import { NextResponse } from "next/server";
import { getPlatformDb } from "@/server/db/client";
import { readJson, route, SESSION_COOKIE, sessionCookieOptions } from "@/server/lib/http";
import { PUBLIC_CREATOR_COOKIE, publicCreatorCookieOptions } from "@/server/lib/public-creator-http";
import { verifyOtp } from "@/server/modules/auth/otp";

export const POST = route({ auth: false, rateLimit: { limit: 10, windowMs: 60_000 } }, async ({ req, ctx }) => {
  const r = await verifyOtp(getPlatformDb(), await readJson(req), ctx);
  if (r.kind === "choose") return NextResponse.json({ choose: r.accounts, choiceToken: r.choiceToken });
  if (r.kind === "creator") {
    // The number belongs to a writer: the Creator Studio session, a different cookie from staff.
    const res = NextResponse.json({ creator: true });
    res.cookies.set(PUBLIC_CREATOR_COOKIE(), r.token, publicCreatorCookieOptions(r.expiresAt));
    return res;
  }
  const res = NextResponse.json({ mfaRequired: r.mfaRequired, mfaEnrolmentRequired: r.mfaEnrolmentRequired, mustChangePassword: r.mustChangePassword });
  res.cookies.set(SESSION_COOKIE(), r.token, sessionCookieOptions(r.expiresAt));
  return res;
});
