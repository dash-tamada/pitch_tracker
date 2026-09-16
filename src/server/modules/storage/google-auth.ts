/**
 * Google service-account OAuth2 (JWT Bearer flow, RFC 7523) for calling the Drive v3 REST API server-side.
 * No `googleapis` / `google-auth-library` dependency: this is ~50 lines of RS256 JWT signing plus one token
 * exchange, matching this codebase's existing style of talking to vendor HTTP APIs directly (see supabase.ts)
 * instead of pulling in their SDKs.
 *
 * Configuration: GOOGLE_SERVICE_ACCOUNT_KEY is the service account's JSON key file, base64-encoded onto one line
 * (`base64 -w0 service-account.json`, or PEM-style text is also accepted). Never commit the raw JSON key.
 */
import { createSign } from "node:crypto";

interface ServiceAccountKey {
  client_email: string;
  private_key: string;
}

let cachedKey: ServiceAccountKey | undefined;

function loadServiceAccountKey(): ServiceAccountKey {
  if (cachedKey) return cachedKey;
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_KEY?.trim();
  if (!raw) throw new Error("GOOGLE_SERVICE_ACCOUNT_KEY is not set");
  const text = raw.startsWith("{") ? raw : Buffer.from(raw, "base64").toString("utf8");
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { throw new Error("GOOGLE_SERVICE_ACCOUNT_KEY is not valid JSON (or base64 of it)"); }
  const key = parsed as Partial<ServiceAccountKey>;
  if (!key.client_email || !key.private_key) throw new Error("GOOGLE_SERVICE_ACCOUNT_KEY is missing client_email or private_key");
  cachedKey = { client_email: key.client_email, private_key: key.private_key };
  return cachedKey;
}

function base64url(input: Buffer | string): string {
  return (typeof input === "string" ? Buffer.from(input) : input).toString("base64url");
}

let cachedToken: { accessToken: string; expiresAt: number } | undefined;

/** A Bearer token scoped to Drive, cached in-process and refreshed a couple of minutes before it expires. */
export async function getDriveAccessToken(): Promise<string> {
  const now = Date.now();
  if (cachedToken && cachedToken.expiresAt - 120_000 > now) return cachedToken.accessToken;

  const { client_email, private_key } = loadServiceAccountKey();
  const iat = Math.floor(now / 1000);
  const exp = iat + 3600;
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = base64url(JSON.stringify({
    iss: client_email,
    scope: "https://www.googleapis.com/auth/drive",
    aud: "https://oauth2.googleapis.com/token",
    iat, exp,
  }));
  const signingInput = `${header}.${claims}`;
  const signature = createSign("RSA-SHA256").update(signingInput).sign(private_key).toString("base64url");
  const assertion = `${signingInput}.${signature}`;

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`Google OAuth token exchange failed (${res.status}): ${(await res.text()).slice(0, 300)}`);
  const data = (await res.json()) as { access_token: string; expires_in: number };
  cachedToken = { accessToken: data.access_token, expiresAt: now + data.expires_in * 1000 };
  return cachedToken.accessToken;
}
