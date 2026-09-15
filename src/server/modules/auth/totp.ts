/** RFC 6238 TOTP (SHA-1, 6 digits, 30 s) with AES-256-GCM encryption of secrets at rest. */
import { createCipheriv, createDecipheriv, createHmac, randomBytes } from "node:crypto";

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(buf: Buffer): string {
  let bits = 0, value = 0, out = "";
  for (const byte of buf) {
    value = (value << 8) | byte; bits += 8;
    while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(s: string): Buffer {
  const clean = s.replace(/=+$/g, "").replace(/\s/g, "").toUpperCase();
  let bits = 0, value = 0; const out: number[] = [];
  for (const ch of clean) {
    const idx = B32.indexOf(ch);
    if (idx < 0) throw new Error("invalid base32");
    value = (value << 5) | idx; bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}

export function hotp(secret: Buffer, counter: number, digits = 6): string {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const mac = createHmac("sha1", secret).update(msg).digest();
  const offset = mac[mac.length - 1]! & 0x0f;
  const code = ((mac[offset]! & 0x7f) << 24) | (mac[offset + 1]! << 16) | (mac[offset + 2]! << 8) | mac[offset + 3]!;
  return String(code % 10 ** digits).padStart(digits, "0");
}

export const STEP_SECONDS = 30;
export const stepAt = (ms: number) => Math.floor(ms / 1000 / STEP_SECONDS);

/** Returns the matched time step (for replay protection) or null. Accepts ±1 step clock drift. */
export function verifyTotp(secret: Buffer, code: string, nowMs = Date.now(), lastUsedStep: number | null = null): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  const current = stepAt(nowMs);
  for (const step of [current - 1, current, current + 1]) {
    if (lastUsedStep !== null && step <= lastUsedStep) continue;
    if (hotp(secret, step) === code) return step;
  }
  return null;
}

export function newTotpSecret(): Buffer {
  return randomBytes(20);
}

export function otpauthUri(secret: Buffer, accountEmail: string, issuer = "Pitch Tracker"): string {
  const label = encodeURIComponent(`${issuer}:${accountEmail}`);
  return `otpauth://totp/${label}?secret=${base32Encode(secret)}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
}

function key(): Buffer {
  const k = Buffer.from(process.env.MFA_ENCRYPTION_KEY ?? "", "base64");
  if (k.length !== 32) throw new Error("MFA_ENCRYPTION_KEY must be 32 bytes (base64)");
  return k;
}

export function encryptSecret(plain: Buffer): Buffer {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(), iv);
  const enc = Buffer.concat([c.update(plain), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), enc]);
}

export function decryptSecret(blob: Buffer): Buffer {
  const iv = blob.subarray(0, 12), tag = blob.subarray(12, 28), enc = blob.subarray(28);
  const d = createDecipheriv("aes-256-gcm", key(), iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(enc), d.final()]);
}
