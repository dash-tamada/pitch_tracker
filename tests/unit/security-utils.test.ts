import { describe, expect, it } from "vitest";
import { safeCsvCell } from "@/server/lib/csv";
import { maskEmail, maskMobile, normalizeMobile, redact } from "@/server/lib/pii";
import { hashPassword, passwordPolicyErrors, verifyPassword } from "@/server/modules/auth/password";
import { base32Decode, base32Encode, decryptSecret, encryptSecret, hotp, verifyTotp } from "@/server/modules/auth/totp";
import { hashToken, newToken } from "@/server/modules/auth/tokens";
import { DEFAULT_ROLE_MATRIX } from "@/server/modules/authz/permissions";
import { canViewPitch, type Actor } from "@/server/modules/authz/policy";

describe("PII masking", () => {
  it("masks Indian mobiles as +91 XXXXX 12345", () => expect(maskMobile("+919876512345")).toBe("+91 XXXXX 12345"));
  it("masks email", () => expect(maskEmail("ravi@example.com")).toBe("r***@example.com"));
  it("normalizes 10-digit, 0-prefixed and +91 numbers identically", () => {
    expect(normalizeMobile("98765 12345")).toBe("+919876512345");
    expect(normalizeMobile("09876512345")).toBe("+919876512345");
    expect(normalizeMobile("+91-98765-12345")).toBe("+919876512345");
    expect(normalizeMobile("12")).toBeNull();
  });
  it("redacts secrets and contact data in audit payloads", () => {
    expect(redact({ password: "x", nested: { accessToken: "t", mobile: "1", title: "ok" } }))
      .toEqual({ password: "[REDACTED]", nested: { accessToken: "[REDACTED]", mobile: "[REDACTED]", title: "ok" } });
  });
});

describe("CSV export injection", () => {
  it.each([["=HYPERLINK(\"http://x\")", "\"'=HYPERLINK(\"\"http://x\"\")\""], ["+1+1", "'+1+1"], ["-2", "'-2"], ["@SUM(A1)", "'@SUM(A1)"], ["Ravi", "Ravi"]])(
    "%s → %s", (input, expected) => expect(safeCsvCell(input)).toBe(expected));
});

describe("passwords", () => {
  it("argon2id hashes verify and are not plaintext", async () => {
    const h = await hashPassword("Correct-Horse-42!");
    expect(h.startsWith("$argon2id$v=19$m=19456,t=2,p=1$")).toBe(true);
    expect(await verifyPassword(h, "Correct-Horse-42!")).toBe(true);
    expect(await verifyPassword(h, "wrong")).toBe(false);
    expect(await verifyPassword("garbage", "x")).toBe(false);
  });
  it("policy rejects short, common and email-derived passwords", () => {
    expect(passwordPolicyErrors("short")).not.toHaveLength(0);
    expect(passwordPolicyErrors("password1234")).not.toHaveLength(0);
    expect(passwordPolicyErrors("durgaji-Strong-99", { email: "durgaji@tamadamedia.com" })).not.toHaveLength(0);
    expect(passwordPolicyErrors("Monsoon-Rains-2026!")).toHaveLength(0);
  });
});

describe("TOTP (RFC 6238 / RFC 4226 vectors)", () => {
  const secret = Buffer.from("12345678901234567890");
  it("matches RFC 4226 HOTP test values", () => {
    expect([0, 1, 2, 3, 9].map((c) => hotp(secret, c))).toEqual(["755224", "287082", "359152", "969429", "520489"]);
  });
  it("matches RFC 6238 SHA-1 vector at T=59s (94287082 → 287082)", () => {
    expect(verifyTotp(secret, "287082", 59_000)).toBe(1);
  });
  it("rejects replay of an already-used step", () => {
    expect(verifyTotp(secret, "287082", 59_000, 1)).toBeNull();
  });
  it("base32 round-trips and secrets encrypt/decrypt with tamper detection", () => {
    expect(base32Decode(base32Encode(secret)).equals(secret)).toBe(true);
    const blob = encryptSecret(secret);
    expect(decryptSecret(blob).equals(secret)).toBe(true);
    blob[blob.length - 1] = blob[blob.length - 1]! ^ 1;
    expect(() => decryptSecret(blob)).toThrow();
  });
});

describe("session tokens", () => {
  it("are 256-bit random and stored only as keyed hashes", () => {
    const t = newToken();
    expect(Buffer.from(t, "base64url")).toHaveLength(32);
    expect(hashToken(t).equals(hashToken(t))).toBe(true);
    expect(hashToken(t).toString("hex")).not.toContain(t);
  });
});

describe("canViewPitch", () => {
  const mk = (role: keyof typeof DEFAULT_ROLE_MATRIX, clearance: Actor["clearance"] = "CONFIDENTIAL"): Actor =>
    ({ userId: "u", companyId: "c", scope: "COMPANY", roles: new Set([role]), permissions: new Set(DEFAULT_ROLE_MATRIX[role].permissions), clearance, mfaSatisfied: true });
  const facts = { confidentiality: "CONFIDENTIAL" as const, currentOwnerId: "other", archivedAt: null, participantReasons: [] as string[] };
  it("employee needs involvement", () => {
    expect(canViewPitch(mk("EMPLOYEE"), facts)).toBe(false);
    expect(canViewPitch(mk("EMPLOYEE"), { ...facts, participantReasons: ["REVIEWED"] })).toBe(true);
  });
  it("admin cannot read pitches (separation of duties)", () => expect(canViewPitch(mk("ADMIN"), facts)).toBe(false));
  it("senior sees all within clearance but not RESTRICTED", () => {
    expect(canViewPitch(mk("SENIOR_EMPLOYEE"), facts)).toBe(true);
    expect(canViewPitch(mk("SENIOR_EMPLOYEE"), { ...facts, confidentiality: "RESTRICTED" })).toBe(false);
  });
  it("explicit GRANTED overrides clearance; archived needs restore permission", () => {
    expect(canViewPitch(mk("EMPLOYEE"), { ...facts, confidentiality: "RESTRICTED", participantReasons: ["GRANTED"] })).toBe(true);
    expect(canViewPitch(mk("SENIOR_EMPLOYEE"), { ...facts, archivedAt: new Date() })).toBe(false);
    expect(canViewPitch(mk("CEO", "RESTRICTED"), { ...facts, archivedAt: new Date() })).toBe(true);
  });
});
