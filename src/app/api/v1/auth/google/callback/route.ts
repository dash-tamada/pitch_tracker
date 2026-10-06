import { NextResponse, type NextRequest } from "next/server";
import { getPlatformDb } from "@/server/db/client";
import { AppError } from "@/server/lib/errors";
import { requestContext, SESSION_COOKIE, sessionCookieOptions } from "@/server/lib/http";
import { verifiedEmailFromCode } from "@/server/modules/auth/google";
import { loginWithGoogle } from "@/server/modules/auth/service";
import { safeEqual } from "@/server/modules/auth/tokens";

const OAUTH_COOKIE = () => (process.env.NODE_ENV === "production" ? "__Host-pt_oauth" : "pt_oauth");

export async function GET(req: NextRequest) {
  const origin = process.env.APP_ORIGIN ?? req.nextUrl.origin;
  const fail = (code: string) => {
    const r = NextResponse.redirect(new URL(`/login?error=${code}`, origin));
    r.cookies.delete(OAUTH_COOKIE());
    return r;
  };
  try {
    const saved = JSON.parse(req.cookies.get(OAUTH_COOKIE())?.value ?? "null") as { state: string; nonce: string; verifier: string } | null;
    const state = req.nextUrl.searchParams.get("state") ?? "";
    const code = req.nextUrl.searchParams.get("code");
    if (req.nextUrl.searchParams.get("error") || !saved || !code || !safeEqual(saved.state, state)) return fail("google_failed");

    const email = await verifiedEmailFromCode(code, saved.verifier, saved.nonce);
    const r = await loginWithGoogle(getPlatformDb(), email, requestContext(req));
    const next = r.mustChangePassword ? "/change-password" : r.mfaEnrolmentRequired ? "/mfa-setup" : r.mfaRequired ? "/login?step=mfa" : "/login?ready=1";
    const res = NextResponse.redirect(new URL(next, origin));
    res.cookies.set(SESSION_COOKIE(), r.token, sessionCookieOptions(r.expiresAt));
    res.cookies.delete(OAUTH_COOKIE());
    return res;
  } catch (err) {
    // Operational detail only (no tokens, no email): which stage failed, and the driver/network error code.
    const cause = (err as { cause?: { code?: string; message?: string } } | null)?.cause;
    console.error(JSON.stringify({ level: "error", route: "google-callback", name: err instanceof Error ? err.name : "unknown",
      message: err instanceof Error ? err.message.slice(0, 300) : undefined, code: (err as { code?: string }).code, dbCode: cause?.code, dbMessage: cause?.message?.slice(0, 200) }));
    return fail(err instanceof AppError && err.code === "GOOGLE_NOT_ALLOWED" ? "google_denied" : "google_failed");
  }
}
