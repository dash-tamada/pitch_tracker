import { NextResponse } from "next/server";
import { readJson } from "@/server/lib/http";
import { PUBLIC_CREATOR_COOKIE, publicCreatorCookieOptions, publicCreatorRoute } from "@/server/lib/public-creator-http";
import { verifyPublicOtp } from "@/server/modules/public-creators/auth";

export const POST = publicCreatorRoute({ auth: false, rateLimit: { limit: 10, windowMs: 60_000 } }, async ({ req, ctx, db }) => {
  const r = await verifyPublicOtp(db, await readJson(req), ctx);
  if (r.kind === "profile") return NextResponse.json({ needsProfile: true, profileToken: r.profileToken });
  const res = NextResponse.json({ signedIn: true });
  res.cookies.set(PUBLIC_CREATOR_COOKIE(), r.token, publicCreatorCookieOptions(r.expiresAt));
  return res;
});
