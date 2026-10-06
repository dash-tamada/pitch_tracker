import { NextResponse } from "next/server";
import { readJson } from "@/server/lib/http";
import { PUBLIC_CREATOR_COOKIE, publicCreatorCookieOptions, publicCreatorRoute } from "@/server/lib/public-creator-http";
import { registerPublicCreator } from "@/server/modules/public-creators/auth";

export const POST = publicCreatorRoute({ auth: false, rateLimit: { limit: 10, windowMs: 60_000 } }, async ({ req, ctx, db }) => {
  const s = await registerPublicCreator(db, await readJson(req), ctx);
  const res = NextResponse.json({ signedIn: true });
  res.cookies.set(PUBLIC_CREATOR_COOKIE(), s.token, publicCreatorCookieOptions(s.expiresAt));
  return res;
});
