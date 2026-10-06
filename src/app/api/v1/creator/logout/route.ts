import { NextResponse } from "next/server";
import { PUBLIC_CREATOR_COOKIE, clearPublicCreatorCookie, publicCreatorRoute } from "@/server/lib/public-creator-http";
import { logoutPublicCreator } from "@/server/modules/public-creators/auth";

export const POST = publicCreatorRoute({}, async ({ req, db }) => {
  await logoutPublicCreator(db, req.cookies.get(PUBLIC_CREATOR_COOKIE())?.value);
  const res = NextResponse.json({ ok: true });
  clearPublicCreatorCookie(res);
  return res;
});
