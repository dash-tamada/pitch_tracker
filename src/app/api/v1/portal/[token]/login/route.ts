import { NextResponse } from "next/server";
import { readJson } from "@/server/lib/http";
import { CREATOR_SESSION_COOKIE, creatorRoute, creatorSessionCookieOptions } from "@/server/lib/creator-http";
import { loginCreator } from "@/server/modules/creator-portal/auth";

export const POST = creatorRoute<{ token: string }>({ auth: false, rateLimit: { limit: 10, windowMs: 60_000 } }, async ({ req, params, ctx }) => {
  const body = (await readJson(req)) as Record<string, unknown>;
  const result = await loginCreator({ ...body, token: params.token }, ctx);
  const res = NextResponse.json({ creatorId: result.creatorId, profileCompleted: result.profileCompleted });
  res.cookies.set(CREATOR_SESSION_COOKIE(), result.token, creatorSessionCookieOptions(result.expiresAt));
  return res;
});
