import { hash, verify } from "@node-rs/argon2";

/** OWASP Password Storage Cheat Sheet argon2id baseline: m=19 MiB, t=2, p=1. */
const ARGON2ID = 2; // Algorithm.Argon2id (const enum cannot be imported under isolatedModules)
const OPTIONS = { algorithm: ARGON2ID, memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;

export const PASSWORD_MIN = 6;
export const PASSWORD_MAX = 128; // bounds hashing cost (DoS)

const COMMON = new Set([
  "password1234", "123456789012", "qwertyuiop12", "passwordpassword", "welcome12345", "iloveyou1234",
  "admin1234567", "letmein12345", "tamadamedia1", "changeme1234",
]);

export function passwordPolicyErrors(password: string, context: { email?: string; fullName?: string } = {}): string[] {
  const errors: string[] = [];
  if (password.length < PASSWORD_MIN) errors.push(`Use at least ${PASSWORD_MIN} characters.`);
  if (password.length > PASSWORD_MAX) errors.push(`Use at most ${PASSWORD_MAX} characters.`);
  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((r) => r.test(password)).length;
  if (password.length < 16 && classes < 3) errors.push("Mix upper-case, lower-case, numbers or symbols, or use 16+ characters.");
  const lower = password.toLowerCase();
  if (COMMON.has(lower)) errors.push("This password is too common.");
  const local = context.email?.split("@")[0]?.toLowerCase();
  if (local && local.length >= 4 && lower.includes(local)) errors.push("Do not include your email name in the password.");
  return errors;
}

export async function hashPassword(password: string): Promise<string> {
  if (password.length > PASSWORD_MAX) throw new Error("password too long");
  return hash(password, OPTIONS as never);
}

export async function verifyPassword(hashed: string, password: string): Promise<boolean> {
  if (password.length > PASSWORD_MAX) return false;
  try {
    return await verify(hashed, password);
  } catch {
    return false;
  }
}

/** Used when the user does not exist so response time does not reveal valid emails. */
let dummyHash: Promise<string> | undefined;
export function getDummyHash(): Promise<string> {
  dummyHash ??= hashPassword("dummy-password-for-timing-equalisation");
  return dummyHash;
}
