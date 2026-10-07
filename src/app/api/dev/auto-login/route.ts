import { NextResponse, type NextRequest } from "next/server";
import { getPlatformDb } from "@/server/db/client";
import { requestContext, SESSION_COOKIE, sessionCookieOptions } from "@/server/lib/http";
import { devAutoLoginEmail, devSignIn } from "@/server/modules/auth/dev-auto-login";

/**
 * Local development only (see dev-auto-login.ts): sign in as DEV_AUTO_LOGIN and continue to `next`.
 * Pages can't set cookies, so the page guard sends session-less visitors here instead of to /login.
 */
export async function GET(req: NextRequest) {
  if (!devAutoLoginEmail()) return new NextResponse("Not found", { status: 404 });
  const origin = process.env.APP_ORIGIN ?? req.nextUrl.origin;
  try {
    const r = await devSignIn(getPlatformDb(), requestContext(req));
    // A session that still needs a step (MFA switched back on, or a temp password) would bounce straight back
    // here from the page guard and loop, so hand those to the real sign-in screen instead.
    if (r.mustChangePassword) return withSession(NextResponse.redirect(new URL("/change-password", origin)), r);
    if (r.mfaRequired) return withSession(NextResponse.redirect(new URL("/login?real=1&step=mfa", origin)), r);
    const home = r.scope === "PLATFORM" ? "/platform" : "/dashboard";
    return withSession(NextResponse.redirect(new URL(safeNext(req.nextUrl.searchParams.get("next")) ?? home, origin)), r);
  } catch (err) {
    console.error(JSON.stringify({ level: "error", route: "dev-auto-login", message: err instanceof Error ? err.message : "unknown" }));
    return NextResponse.redirect(new URL("/login?real=1", origin));
  }
}

function withSession(res: NextResponse, r: { token: string; expiresAt: Date }) {
  res.cookies.set(SESSION_COOKIE(), r.token, sessionCookieOptions(r.expiresAt));
  return res;
}

/** Same-origin paths only — never "//host" or another scheme, and never back into this route. */
function safeNext(v: string | null): string | null {
  if (!v || !v.startsWith("/") || v.startsWith("//") || v.startsWith("/\\") || v.startsWith("/api/dev/")) return null;
  if (v === "/login" || v.startsWith("/login?")) return null;
  return v;
}
