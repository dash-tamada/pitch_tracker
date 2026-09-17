import { NextResponse } from "next/server";
import { CREATOR_SESSION_COOKIE, clearCreatorSessionCookie, creatorRoute } from "@/server/lib/creator-http";
import { logoutCreator } from "@/server/modules/creator-portal/auth";

export const POST = creatorRoute<{ token: string }>({ auth: true }, async ({ req, companyId, creator }) => {
  await logoutCreator(companyId, creator!.creatorId, req.cookies.get(CREATOR_SESSION_COOKIE())?.value);
  const res = NextResponse.json({ ok: true });
  clearCreatorSessionCookie(res);
  return res;
});
