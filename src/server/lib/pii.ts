/** Server-side masking of creator personal data for users without `creator.view_pii`. */

export function maskMobile(e164: string | null | undefined): string | null {
  if (!e164) return null;
  const digits = e164.replace(/\D/g, "");
  if (digits.length < 7) return "XXXXX";
  const last = digits.slice(-5);
  const cc = e164.startsWith("+91") ? "+91 " : "+";
  return `${cc}XXXXX ${last}`;
}

export function maskEmail(email: string | null | undefined): string | null {
  if (!email) return null;
  const at = email.indexOf("@");
  if (at < 1) return "***";
  return `${email[0]}***@${email.slice(at + 1)}`;
}

/** Normalizes an Indian or international mobile number to E.164; returns null if invalid. */
export function normalizeMobile(input: string, defaultCountry = "91"): string | null {
  const trimmed = input.trim();
  let digits = trimmed.replace(/[^\d]/g, "");
  if (trimmed.startsWith("+")) {
    // already international
  } else if (digits.length === 10) {
    digits = defaultCountry + digits;
  } else if (digits.length === 11 && digits.startsWith("0")) {
    digits = defaultCountry + digits.slice(1);
  }
  const e164 = `+${digits}`;
  return /^\+[1-9]\d{7,14}$/.test(e164) ? e164 : null;
}

export function normalizeEmail(input: string): string {
  return input.trim().toLowerCase();
}

export function normalizeName(input: string): string {
  return input.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
}

const REDACT_KEYS = /pass(word)?|token|secret|authorization|cookie|otp|mfa|mobile|phone|email/i;

/** Redacts sensitive keys before a value is written to audit logs or application logs. */
export function redact(value: unknown, depth = 0): unknown {
  if (depth > 6 || value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = REDACT_KEYS.test(k) ? "[REDACTED]" : redact(v, depth + 1);
  }
  return out;
}
