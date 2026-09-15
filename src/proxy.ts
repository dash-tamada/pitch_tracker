import { NextResponse, type NextRequest } from "next/server";

/** Per-request CSP nonce + CSRF cookie. Static security headers are in next.config.ts. */
export function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const isDev = process.env.NODE_ENV === "development";
  const csp = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ""}`,
    `style-src 'self' 'nonce-${nonce}'`,
    "img-src 'self' blob: data:",
    "font-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(isDev ? [] : ["upgrade-insecure-requests"]),
  ].join("; ");

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", csp);

  const csrfName = process.env.NODE_ENV === "production" ? "__Host-pt_csrf" : "pt_csrf";
  if (!request.cookies.get(csrfName)) {
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    const token = Buffer.from(bytes).toString("base64url");
    // Readable by our own JS (double-submit pattern); SameSite=Strict; never sent cross-site.
    response.cookies.set(csrfName, token, { httpOnly: false, secure: process.env.NODE_ENV === "production", sameSite: "strict", path: "/" });
  }
  return response;
}

export const config = {
  matcher: [
    {
      source: "/((?!_next/static|_next/image|favicon.ico).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
