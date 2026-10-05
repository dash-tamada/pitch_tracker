import { NextResponse, type NextRequest } from "next/server";
import { authorizeUrl, googleEnabled, newOAuthState } from "@/server/modules/auth/google";

const OAUTH_COOKIE = () => (process.env.NODE_ENV === "production" ? "__Host-pt_oauth" : "pt_oauth");

export function GET(req: NextRequest) {
  if (!googleEnabled()) return NextResponse.redirect(new URL("/login?error=google_off", process.env.APP_ORIGIN ?? req.url));
  const s = newOAuthState();
  const res = NextResponse.redirect(authorizeUrl(s));
  // Lax so it comes back on Google's top-level redirect; short-lived; holds the one-time state, nonce and PKCE verifier.
  res.cookies.set(OAUTH_COOKIE(), JSON.stringify({ state: s.state, nonce: s.nonce, verifier: s.verifier }),
    { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 600 });
  return res;
}
