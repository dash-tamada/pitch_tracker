import { randomUUID } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { getDb } from "@/server/db/client";
import { AppError } from "@/server/lib/errors";
import { hit } from "@/server/lib/rate-limit";
import { safeEqual } from "@/server/modules/auth/tokens";
import { resolveSession, type SessionInfo } from "@/server/modules/auth/service";
import type { RequestContext } from "@/server/modules/audit/service";

const isProd = () => process.env.NODE_ENV === "production";
export const SESSION_COOKIE = () => (isProd() ? "__Host-pt_session" : "pt_session");
export const CSRF_COOKIE = () => (isProd() ? "__Host-pt_csrf" : "pt_csrf");
const MAX_JSON_BYTES = 1_000_000;

export function requestContext(req: NextRequest): RequestContext {
  // Only trust X-Forwarded-For behind our own load balancer. Take the LAST entry: that is the one the
  // trusted proxy appended; earlier entries are client-controlled and spoofable.
  const xff = process.env.TRUST_PROXY === "true" ? req.headers.get("x-forwarded-for")?.split(",").at(-1)?.trim() : undefined;
  const ip = xff && /^[0-9a-fA-F:.]{3,45}$/.test(xff) ? xff : null;
  return { ip, userAgent: req.headers.get("user-agent"), requestId: randomUUID() };
}

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

export async function readJson(req: NextRequest): Promise<unknown> {
  const len = Number(req.headers.get("content-length") ?? "0");
  if (len > MAX_JSON_BYTES) throw new AppError("PAYLOAD_TOO_LARGE", "Request is too large.");
  if (!(req.headers.get("content-type") ?? "").startsWith("application/json")) throw new AppError("VALIDATION", "Expected JSON.");
  const text = await req.text();
  if (text.length > MAX_JSON_BYTES) throw new AppError("PAYLOAD_TOO_LARGE", "Request is too large.");
  try {
    // Reject prototype-pollution keys outright.
    return JSON.parse(text, (k, v) => { if (k === "__proto__" || k === "constructor" || k === "prototype") throw new Error("bad key"); return v; });
  } catch {
    throw new AppError("VALIDATION", "Malformed JSON.");
  }
}

interface RouteOptions { auth?: boolean; allowWithoutMfa?: boolean; rateLimit?: { limit: number; windowMs: number } }
type Handler<P> = (args: { req: NextRequest; ctx: RequestContext; session: SessionInfo | null; params: P }) => Promise<Response>;

export function route<P = Record<string, never>>(opts: RouteOptions, handler: Handler<P>) {
  return async (req: NextRequest, routeCtx: { params: Promise<P> }): Promise<Response> => {
    const ctx = requestContext(req);
    try {
      const rl = opts.rateLimit ?? { limit: 120, windowMs: 60_000 };
      if (!hit(`${ctx.ip ?? "unknown"}:${req.nextUrl.pathname}:${req.method}`, rl.limit, rl.windowMs)) {
        throw new AppError("RATE_LIMITED", "Too many requests. Please slow down.");
      }
      checkCsrf(req);
      let session: SessionInfo | null = null;
      if (opts.auth !== false) {
        session = await resolveSession(getDb(), req.cookies.get(SESSION_COOKIE())?.value);
        if (!session) throw new AppError("UNAUTHENTICATED", "Please sign in.");
        if (!session.mfaVerified && !opts.allowWithoutMfa) throw new AppError("MFA_REQUIRED", "Verify your second factor to continue.");
      }
      const params = (await routeCtx.params) ?? ({} as P);
      const res = await handler({ req, ctx, session, params });
      res.headers.set("x-request-id", ctx.requestId!);
      return res;
    } catch (err) {
      return errorResponse(err, ctx.requestId!);
    }
  };
}

export function errorResponse(err: unknown, requestId: string): Response {
  if (err instanceof AppError) {
    return NextResponse.json({ error: { code: err.code, message: err.message, fields: err.fields } }, { status: err.status, headers: { "x-request-id": requestId } });
  }
  if (err && typeof err === "object" && (err as { name?: string }).name === "ZodError") {
    return NextResponse.json({ error: { code: "VALIDATION", message: "The request is not valid." } }, { status: 400 });
  }
  // Details go to server logs only — never to the client.
  // Driver errors embed SQL parameters (possibly personal data) in `message`, so log only structured codes.
  const cause = (err as { cause?: { code?: string; constraint?: string } } | null)?.cause;
  console.error(JSON.stringify({ level: "error", requestId, name: err instanceof Error ? err.name : "unknown",
    dbCode: cause?.code, dbConstraint: cause?.constraint }));
  return NextResponse.json({ error: { code: "INTERNAL", message: "Something went wrong. Please try again.", requestId } }, { status: 500 });
}

export function ok(body: unknown, status = 200): Response {
  return NextResponse.json(body, { status });
}

export function sessionCookieOptions(expires: Date) {
  return { httpOnly: true, secure: isProd(), sameSite: "lax" as const, path: "/", expires };
}

/** Query string → plain object (single values only; repeated keys become arrays). */
export function queryObject(req: NextRequest): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {};
  for (const [k, v] of req.nextUrl.searchParams) {
    const prev = out[k];
    out[k] = prev === undefined ? v : Array.isArray(prev) ? [...prev, v] : [prev, v];
  }
  return out;
}

export function uuidParam(id: string, what = "Record"): string {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) throw new AppError("NOT_FOUND", `${what} not found.`);
  return id.toLowerCase();
}

export { requirePermission as requirePermissionRoute } from "@/server/modules/authz/policy";
