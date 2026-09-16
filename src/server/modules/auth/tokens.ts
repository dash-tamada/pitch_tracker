import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

function pepper(): Buffer {
  const p = process.env.SESSION_TOKEN_PEPPER;
  if (!p || Buffer.from(p, "base64").length < 32) throw new Error("SESSION_TOKEN_PEPPER must be at least 32 bytes (base64)");
  return Buffer.from(p, "base64");
}

/** 256-bit random token for cookies / reset links. */
export function newToken(): string {
  return randomBytes(32).toString("base64url");
}

/** Only this keyed hash is stored; a database leak does not yield usable session tokens. */
export function hashToken(token: string): Buffer {
  return createHmac("sha256", pepper()).update(token).digest();
}

export function hashIdentifier(value: string): Buffer {
  return createHmac("sha256", pepper()).update(`id:${value.trim().toLowerCase()}`).digest();
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a), bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/**
 * A short-lived signed string that needs no server-side storage to verify later (e.g. a one-time Drive
 * download URL): the payload travels inside the token itself, so any server instance can check it, which
 * a plain in-memory token map cannot do once there is more than one instance (serverless deployments).
 */
export function signValue(value: string): string {
  const mac = createHmac("sha256", pepper()).update(value).digest("base64url");
  return `${Buffer.from(value, "utf8").toString("base64url")}.${mac}`;
}

export function verifySignedValue(token: string): string | null {
  const i = token.lastIndexOf(".");
  if (i < 0) return null;
  const encoded = token.slice(0, i), mac = token.slice(i + 1);
  let value: string;
  try { value = Buffer.from(encoded, "base64url").toString("utf8"); } catch { return null; }
  const expected = createHmac("sha256", pepper()).update(value).digest("base64url");
  return safeEqual(mac, expected) ? value : null;
}
