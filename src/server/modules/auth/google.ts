import { createHash, randomBytes } from "node:crypto";

/**
 * "Sign in with Google" — OpenID Connect authorization-code flow with PKCE, using only fetch.
 * Enabled when GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are set; the redirect URI is APP_ORIGIN + CALLBACK_PATH.
 */
export const CALLBACK_PATH = "/api/v1/auth/google/callback";
export const googleEnabled = () => Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.APP_ORIGIN);

const redirectUri = () => `${process.env.APP_ORIGIN}${CALLBACK_PATH}`;
const b64u = (b: Buffer) => b.toString("base64url");

export function newOAuthState() {
  const verifier = b64u(randomBytes(32));
  return { state: b64u(randomBytes(24)), nonce: b64u(randomBytes(24)), verifier, challenge: b64u(createHash("sha256").update(verifier).digest()) };
}

export function authorizeUrl(s: { state: string; nonce: string; challenge: string }): string {
  const q = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID!, redirect_uri: redirectUri(), response_type: "code", scope: "openid email",
    state: s.state, nonce: s.nonce, code_challenge: s.challenge, code_challenge_method: "S256", prompt: "select_account",
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${q}`;
}

/** Exchanges the code and returns the Google-verified email. Throws on anything that does not check out. */
export async function verifiedEmailFromCode(code: string, verifier: string, nonce: string): Promise<string> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code, client_id: process.env.GOOGLE_CLIENT_ID!, client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      redirect_uri: redirectUri(), grant_type: "authorization_code", code_verifier: verifier,
    }),
  });
  if (!res.ok) throw new Error("google token exchange failed");
  const { id_token } = (await res.json()) as { id_token?: string };
  if (!id_token) throw new Error("no id_token");
  // The token came straight from Google's token endpoint over TLS in exchange for our secret, so its claims
  // can be trusted without re-checking the signature (OIDC Core §3.1.3.7); we still validate every claim.
  const claims = JSON.parse(Buffer.from(id_token.split(".")[1] ?? "", "base64url").toString("utf8")) as {
    iss?: string; aud?: string; exp?: number; nonce?: string; email?: string; email_verified?: boolean | string;
  };
  const issuerOk = claims.iss === "https://accounts.google.com" || claims.iss === "accounts.google.com";
  const verified = claims.email_verified === true || claims.email_verified === "true";
  if (!issuerOk || claims.aud !== process.env.GOOGLE_CLIENT_ID || !claims.exp || claims.exp * 1000 < Date.now()
    || claims.nonce !== nonce || !verified || !claims.email) throw new Error("invalid id_token claims");
  return claims.email;
}
