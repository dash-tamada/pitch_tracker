/**
 * HTTP wiring for creator-portal routes — the pitch_creator-role counterpart to route() in http.ts.
 * Deliberately separate rather than a mode flag on route(): a creator is never a staff session under the
 * hood (different session-cookie namespace, different resolver, different database role — see CreatorPool
 * in db/client.ts), and keeping the wiring apart means a bug here can never widen staff session handling
 * and vice versa.
 *
 * CSRF protection, however, is deliberately the SAME site-wide double-submit cookie staff routes use
 * (CSRF_COOKIE from http.ts, minted for every request by proxy.ts's global middleware — it does not know
 * or care about creator vs. staff). That cookie's only job is proving a request's JS could read a
 * same-origin cookie; it carries no identity of its own; a second creator-only CSRF cookie would need its
 * own minting logic in proxy.ts (which reaches /portal/* too), and until that existed no creator-portal
 * write could ever pass CSRF at all. Reusing it is correct, not a shortcut: identity for creator routes
 * comes entirely from the separate CREATOR_SESSION_COOKIE below, which the CSRF cookie can never substitute for.
 */
import { NextResponse, type NextRequest } from "next/server";
import { AppError } from "@/server/lib/errors";
import { CSRF_COOKIE, errorResponse, requestContext } from "@/server/lib/http";
import { hit } from "@/server/lib/rate-limit";
import { safeEqual } from "@/server/modules/auth/tokens";
import { resolveCreatorSession, resolvePortalCompany, type CreatorSessionInfo } from "@/server/modules/creator-portal/auth";
import type { RequestContext } from "@/server/modules/audit/service";

const isProd = () => process.env.NODE_ENV === "production";
export const CREATOR_SESSION_COOKIE = () => (isProd() ? "__Host-pt_creator_session" : "pt_creator_session");

// Same shape as checkCsrf in http.ts (duplicated because http.ts's version is not exported) — see the
// file-level comment above for why this deliberately reads the shared CSRF_COOKIE, not a creator-only one.
function checkCsrf(req: NextRequest): void {
  if (req.method === "GET" || req.method === "HEAD") return;
  const origin = req.headers.get("origin");
  const expected = process.env.APP_ORIGIN;
  if (origin) {
    if (!expected || origin !== expected) throw new AppError("CSRF", "Request blocked.");
  } else if (req.headers.get("sec-fetch-site") !== "same-origin") {
    throw new AppError("CSRF", "Request blocked.");
  }
  const cookie = req.cookies.get(CSRF_COOKIE())?.value;
  const header = req.headers.get("x-csrf-token");
  if (!cookie || !header || !safeEqual(cookie, header)) throw new AppError("CSRF", "Request blocked.");
}

interface CreatorRouteOptions {
  /** Default true. Set false only for register/login/link-resolution endpoints. */
  auth?: boolean;
  rateLimit?: { limit: number; windowMs: number };
}

type Handler<P> = (args: {
  req: NextRequest; ctx: RequestContext; companyId: string; creator: CreatorSessionInfo | null; params: P;
}) => Promise<Response>;

/**
 * Every creator-portal route is reached as /portal/[token]/... — the token in the URL is resolved to a
 * company on every single request (never cached in a cookie), so disabling or rotating a company's link
 * (tenancy/company.ts: rotateCreatorPortalLink/disableCreatorPortalLink) takes effect on the very next
 * request, including for creators who are already mid-session. Authenticated routes additionally require a
 * valid creator session cookie: resolveCreatorSession resolves it inside THIS company's app.company_id
 * context, so a session cookie minted under a different company's link (or a different company's link
 * entirely) resolves to null here rather than ever being treated as this company's creator.
 */
export function creatorRoute<P extends { token: string }>(opts: CreatorRouteOptions, handler: Handler<P>) {
  return async (req: NextRequest, routeCtx: { params: Promise<P> }): Promise<Response> => {
    const ctx = requestContext(req);
    try {
      const rl = opts.rateLimit ?? { limit: 60, windowMs: 60_000 };
      if (!hit(`${ctx.ip ?? "unknown"}:${req.nextUrl.pathname}:${req.method}`, rl.limit, rl.windowMs)) {
        throw new AppError("RATE_LIMITED", "Too many requests. Please slow down.");
      }
      checkCsrf(req);
      const params = (await routeCtx.params) ?? ({} as P);
      const companyId = await resolvePortalCompany(params.token);
      if (!companyId) throw new AppError("NOT_FOUND", "This link is not valid or has been disabled.");

      let creator: CreatorSessionInfo | null = null;
      if (opts.auth !== false) {
        creator = await resolveCreatorSession(companyId, req.cookies.get(CREATOR_SESSION_COOKIE())?.value);
        if (!creator) throw new AppError("UNAUTHENTICATED", "Please sign in.");
      }
      const res = await handler({ req, ctx, companyId, creator, params });
      res.headers.set("x-request-id", ctx.requestId!);
      return res;
    } catch (err) {
      return errorResponse(err, ctx.requestId!);
    }
  };
}

export function creatorSessionCookieOptions(expires: Date) {
  return { httpOnly: true, secure: isProd(), sameSite: "lax" as const, path: "/", expires };
}

export function clearCreatorSessionCookie(res: NextResponse): void {
  res.cookies.set(CREATOR_SESSION_COOKIE(), "", { httpOnly: true, secure: isProd(), sameSite: "lax", path: "/", expires: new Date(0) });
}
