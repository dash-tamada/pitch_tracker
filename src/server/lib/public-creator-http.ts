/**
 * HTTP wiring for the platform-wide creator area (/creator, /api/v1/creator/*). Like creatorRoute() for company
 * portals it is deliberately separate from the staff route(): own cookie, own session resolver, own tables.
 * CSRF is the same site-wide double-submit cookie every other route uses.
 */
import { NextResponse, type NextRequest } from "next/server";
import { getPlatformDb } from "@/server/db/client";
import type { Db } from "@/server/db/client";
import { AppError } from "@/server/lib/errors";
import { checkCsrf, errorResponse, requestContext } from "@/server/lib/http";
import { hit } from "@/server/lib/rate-limit";
import { resolvePublicSession, type PublicCreatorSession } from "@/server/modules/public-creators/auth";
import type { RequestContext } from "@/server/modules/audit/service";

const isProd = () => process.env.NODE_ENV === "production";
export const PUBLIC_CREATOR_COOKIE = () => (isProd() ? "__Host-pt_public_creator" : "pt_public_creator");

interface Options { auth?: boolean; rateLimit?: { limit: number; windowMs: number } }
type Handler<P> = (a: { req: NextRequest; ctx: RequestContext; db: Db; creator: PublicCreatorSession | null; params: P }) => Promise<Response>;

export function publicCreatorRoute<P = Record<string, never>>(opts: Options, handler: Handler<P>) {
  return async (req: NextRequest, routeCtx: { params: Promise<P> }): Promise<Response> => {
    const ctx = requestContext(req);
    try {
      const rl = opts.rateLimit ?? { limit: 60, windowMs: 60_000 };
      if (!hit(`${ctx.ip ?? "unknown"}:${req.nextUrl.pathname}:${req.method}`, rl.limit, rl.windowMs)) throw new AppError("RATE_LIMITED", "Too many requests. Please slow down.");
      checkCsrf(req);
      const db = getPlatformDb();
      let creator: PublicCreatorSession | null = null;
      if (opts.auth !== false) {
        creator = await resolvePublicSession(db, req.cookies.get(PUBLIC_CREATOR_COOKIE())?.value);
        if (!creator) throw new AppError("UNAUTHENTICATED", "Please sign in.");
      }
      const params = (await routeCtx.params) ?? ({} as P);
      const res = await handler({ req, ctx, db, creator, params });
      res.headers.set("x-request-id", ctx.requestId!);
      return res;
    } catch (err) {
      return errorResponse(err, ctx.requestId!);
    }
  };
}

export function publicCreatorCookieOptions(expires: Date) {
  return { httpOnly: true, secure: isProd(), sameSite: "lax" as const, path: "/", expires };
}
export function clearPublicCreatorCookie(res: NextResponse): void {
  res.cookies.set(PUBLIC_CREATOR_COOKIE(), "", { httpOnly: true, secure: isProd(), sameSite: "lax", path: "/", expires: new Date(0) });
}
