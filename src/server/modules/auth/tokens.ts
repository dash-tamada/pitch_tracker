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
