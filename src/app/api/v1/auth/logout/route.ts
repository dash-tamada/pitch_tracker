import { NextResponse } from "next/server";
import { getPlatformDb } from "@/server/db/client";
import { route, SESSION_COOKIE } from "@/server/lib/http";
import { logout } from "@/server/modules/auth/service";

// Always reachable — including with a pending forced password change — so nobody is ever trapped on that screen.
export const POST = route({ auth: true, scope: "ANY", allowWithoutMfa: true, allowWithoutPasswordChange: true }, async ({ req, ctx }) => {
  await logout(getPlatformDb(), req.cookies.get(SESSION_COOKIE())?.value, ctx);
  const res = NextResponse.json({ ok: true });
  res.cookies.delete(SESSION_COOKIE());
  return res;
});
