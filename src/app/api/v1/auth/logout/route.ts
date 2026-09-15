import { NextResponse } from "next/server";
import { getDb } from "@/server/db/client";
import { route, SESSION_COOKIE } from "@/server/lib/http";
import { logout } from "@/server/modules/auth/service";

export const POST = route({ auth: true, allowWithoutMfa: true }, async ({ req, ctx }) => {
  await logout(getDb(), req.cookies.get(SESSION_COOKIE())?.value, ctx);
  const res = NextResponse.json({ ok: true });
  res.cookies.delete(SESSION_COOKIE());
  return res;
});
