/** Application errors carry a stable code and a message that is safe to show users. */
export type ErrorCode =
  | "UNAUTHENTICATED" | "MFA_REQUIRED" | "PASSWORD_CHANGE_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION"
  | "CONFLICT" | "STALE_VERSION" | "RATE_LIMITED" | "ACCOUNT_LOCKED" | "INVALID_CREDENTIALS"
  | "TRANSITION_NOT_ALLOWED" | "NOT_CURRENT_OWNER" | "INVALID_RECIPIENT" | "SELF_APPROVAL_BLOCKED"
  | "CSRF" | "PAYLOAD_TOO_LARGE" | "COMPANY_UNAVAILABLE" | "PLAN_LIMIT" | "INTERNAL";

const STATUS: Record<ErrorCode, number> = {
  UNAUTHENTICATED: 401, MFA_REQUIRED: 401, PASSWORD_CHANGE_REQUIRED: 401, INVALID_CREDENTIALS: 401, FORBIDDEN: 403, CSRF: 403,
  NOT_FOUND: 404, VALIDATION: 400, CONFLICT: 409, STALE_VERSION: 409, TRANSITION_NOT_ALLOWED: 409,
  NOT_CURRENT_OWNER: 403, INVALID_RECIPIENT: 400, SELF_APPROVAL_BLOCKED: 403,
  RATE_LIMITED: 429, ACCOUNT_LOCKED: 423, PAYLOAD_TOO_LARGE: 413, COMPANY_UNAVAILABLE: 403, PLAN_LIMIT: 402, INTERNAL: 500,
};

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly fields: Record<string, string> | undefined;

  constructor(code: ErrorCode, message: string, fields?: Record<string, string>) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.status = STATUS[code];
    this.fields = fields;
  }
}

export const notFound = (what = "Record") => new AppError("NOT_FOUND", `${what} not found.`);
export const forbidden = (msg = "You do not have permission to do this.") => new AppError("FORBIDDEN", msg);
export const validation = (message: string, fields?: Record<string, string>) =>
  new AppError("VALIDATION", message, fields);
