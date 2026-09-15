# Security Model — Pitch Tracker

Status: **Phase 1 foundation. Not production-ready.** This document separates what is implemented and tested from what is designed but not yet built. The application must not be described as "secure" or "production-ready" until every item in §12 is Confirmed.

No system is hack-proof. The approach is defence-in-depth: every control below assumes the one before it might fail.

Reporting a vulnerability: email `[PLACEHOLDER: security contact]` — do not open a public issue.

---

## 1. Authentication

| Control | Status |
|---|---|
| Passwords hashed with argon2id (m=19 MiB, t=2, p=1), max 128 chars to bound hashing cost | Implemented, tested |
| Password policy: ≥12 chars, character mix unless ≥16, common-password and email-name checks | Implemented, tested |
| Opaque 256-bit session tokens; only HMAC-SHA256(pepper, token) stored in DB | Implemented, tested |
| Cookie: `__Host-` prefix, `HttpOnly`, `Secure`, `SameSite=Lax` in production | Implemented, verified over HTTP |
| Session expiry: 12 h absolute, 30 min idle; logout revokes server-side | Implemented, tested |
| Disabled/archived users lose access on next request | Implemented, tested |
| Account lockout: 5 consecutive failures → 15 min | Implemented, tested |
| IP-based login throttling (30 failures / 15 min, DB-backed, works across instances) | Implemented, tested |
| Same error for unknown email and wrong password; dummy hash equalises timing | Implemented, tested |
| TOTP MFA (RFC 6238), secret encrypted with AES-256-GCM, replay protection | Implemented; algorithm tested against RFC vectors; enrolment endpoints not yet covered by integration tests |
| MFA mandatory for Super Admin, Admin, CEO, COO — their sessions cannot act until verified | Implemented, tested |
| Password reset (single-use hashed token, 30 min) | **Not built** — table exists |
| Email verification for new users | **Not built** |
| Session rotation on privilege change (`revokeAllSessions`) | Function exists; not yet wired to role changes (no user-admin API yet) |

## 2. Authorization

Three layers, all server-side — hiding a button is never a control.

1. **Role → permission** (`roles`, `role_permissions`, `user_roles` tables; defaults in `src/server/modules/authz/permissions.ts`).
2. **Resource policy** (`canViewPitch` + its SQL twin `pitchVisibilityCondition`): need-to-know (current owner, participant, or `pitch.view_all`) **and** clearance ≥ pitch confidentiality. Failed access returns **404**, never 403, so IDs cannot be probed.
3. **Workflow rules** (`src/server/modules/workflow/rules.ts`): the transition must exist for the current stage in the pitch's pinned workflow version; permission, allowed roles, current-owner requirement, required fields, recipient eligibility, self-approval policy and optimistic version are all checked.

Separation of duties: **Admin cannot read pitches or scripts**; Admin manages users, platforms and configuration.

Tested abuse cases (`tests/integration/security.test.ts`): uninvolved user by changing pitch ID (IDOR), random IDs, Admin reading pitches, list-filter parity with the policy for every user × pitch, skipping stages via API, CEO acting on an employee's review, mass assignment, stale concurrent actions, self-approval, creating a pitch above one's clearance, exec without MFA, Viewer creating pitches.

## 3. Workflow and data integrity (enforced inside PostgreSQL)

| Invariant | Mechanism | Status |
|---|---|---|
| Workflow history, platform responses, ratings, audit logs, download logs, scan results, dev/prod updates cannot be edited or deleted | `BEFORE UPDATE OR DELETE` triggers (block even the table owner) + app role has only `SELECT, INSERT` | Implemented; verified as app role **and** as owner |
| Script versions immutable except one-time scan result | Trigger `document_versions_guard` | Implemented; not yet exercised by upload tests |
| Rejection must have category + reason ≥ 10 chars | `CHECK` constraint + engine validation | Implemented, tested at both layers |
| Forward must record recipient; platform approval must name platform | `CHECK` constraints | Implemented |
| Pitches cannot be hard-deleted | Trigger + no `DELETE` grant | Implemented, tested |
| Workflow definitions in use cannot be edited in place | Trigger `workflow_config_guard` | Implemented |
| App role cannot run DDL or disable triggers | Separate `pitch_migrator` role | Implemented, tested |
| Current stage/owner derivable from history (rule 20) | `foldEvents` reconciliation | Implemented, tested; nightly job **not built** |

## 4. API security

| Control | Status |
|---|---|
| Zod `.strict()` schemas — unknown keys rejected (mass assignment) | Implemented, tested |
| JSON body cap 1 MB; `__proto__`/`constructor`/`prototype` keys rejected | Implemented, verified over HTTP |
| CSRF: Origin must equal `APP_ORIGIN` + double-submit token (`SameSite=Strict` cookie) | Implemented, verified over HTTP |
| Per-instance rate limiting on every route | Implemented. **Risk:** in-memory, so it does not coordinate across instances — production must also rate-limit at the edge (WAF). Behind a load balancer set `TRUST_PROXY=true`, otherwise every user shares one "unknown IP" bucket and IP login throttling is off |
| Safe errors: `{code, message}` only; 500s return a generic message + request ID; DB error text (which contains query parameters) is never logged | Implemented |
| UUID path params validated before use | Implemented |
| SQL only through Drizzle parameterized queries; no string concatenation | Implemented; injection test passes |
| CORS: no CORS headers are sent, so browsers block cross-origin reads | Implemented (default) |

## 5. Security headers

Set in `next.config.ts` and `src/proxy.ts`, verified on a production build: `Content-Security-Policy` with per-request nonce and `strict-dynamic`, `object-src 'none'`, `frame-ancestors 'none'`; `Strict-Transport-Security` (2 years, preload); `X-Content-Type-Options: nosniff`; `X-Frame-Options: DENY`; `Referrer-Policy: strict-origin-when-cross-origin`; `Permissions-Policy` disabling camera/mic/geolocation/payment/USB; `Cross-Origin-Opener-Policy`; `X-Powered-By` removed; API responses `Cache-Control: no-store`.

## 6. File security (designed — **not built**, Phase 3)

Private S3-compatible bucket with Block Public Access and SSE-KMS; upload via server-issued intent → presigned PUT with size condition into a `quarantine/` prefix; worker validates magic bytes against an allowlist (PDF, DOC, DOCX, TXT, PPT, PPTX, JPG, PNG, WEBP — **no SVG, no macros-enabled formats**), size, SHA-256, ClamAV scan; clean files moved to `clean/` and only then downloadable. Server-generated storage keys (no user input in paths). Downloads: permission + resource check → audit row in `document_access_logs` → 60-second presigned GET with `Content-Disposition: attachment`. Browser MIME type is never trusted.

## 7. Personal data

- Creator mobile/email masked on the server for users without `creator.view_pii` (`+91 XXXXX 12345`) — implemented, tested.
- Audit payloads pass through `redact()` (passwords, tokens, secrets, mobile, email) — implemented, tested.
- Login attempts store an HMAC of the email, not the email.
- Consent basis + timestamp fields on creators.
- Notifications carry the pitch title only; email jobs carry only a notification ID — never synopsis or script text.
- Links (website, social) are stored and displayed only; the server never fetches them (no SSRF surface). `javascript:` URLs rejected.
- CSV exports must use `safeCsvCell` (formula-injection neutralisation) — helper implemented and tested; exports **not built**.
- `Unknown:` retention periods (DPDP Act 2023) — decide with legal counsel; see ARCHITECTURE §9.

## 8. Secrets management

- No secrets in source. `.env.example` has placeholders only; `.env*` is git-ignored.
- Server-only variables are never prefixed `NEXT_PUBLIC_`.
- Required secrets: `DATABASE_URL`, `MIGRATION_DATABASE_URL`, `SESSION_TOKEN_PEPPER` (≥32 bytes), `MFA_ENCRYPTION_KEY` (32 bytes), storage and SMTP credentials. In production load them from a secret manager (e.g. AWS Secrets Manager), separate per environment.
- If any secret is ever committed or pasted anywhere public: rotate it, then purge it from Git history. Rotating `SESSION_TOKEN_PEPPER` logs everyone out; rotating `MFA_ENCRYPTION_KEY` requires re-encrypting MFA secrets (script **not built**).

## 9. Audit logging

`audit_logs` is append-only. Currently recorded: login, failed login, lockout, rate-limit, logout, MFA enrol/verify/fail, creator created, pitch created, every workflow action (with before/after stage and owner). **Not yet recorded** because the features do not exist: pitch edits, uploads, downloads, platform/permission changes, exports.

## 10. Backups & incident response (designed — not configured)

Managed PostgreSQL with automated encrypted backups, point-in-time recovery (35 days), cross-region copy; quarterly restore test into staging with the result recorded. Incident steps: contain (revoke sessions: `UPDATE sessions SET revoked_at = now()`; disable accounts), preserve audit logs and download logs, rotate secrets, assess personal-data exposure and notify as legally required, post-mortem.

## 11. Dependencies

Exact versions pinned with a lockfile. `npm audit --omit=dev`: **0 vulnerabilities** (15 Sep 2026). Dev-only: 4 moderate advisories in `esbuild` bundled inside `drizzle-kit` (affects esbuild's dev server, which this project does not run). Add Dependabot/Renovate and `gitleaks` in CI before production.

## 12. Release gate (current status)

| Item | Status |
|---|---|
| No secrets hard-coded or exposed | Confirmed (repo scan before commit) |
| No production credentials in Git | Confirmed (none exist yet) |
| Authentication verified | Confirmed for password, session, lockout, MFA gate; password reset not built |
| Authorization verified | Confirmed for pitches/workflow/creators built so far |
| IDOR/BOLA checked | Confirmed for built endpoints |
| SQL injection checked | Confirmed |
| XSS checked | Likely (not verified): React escaping + strict CSP; no browser-based test yet |
| CSRF checked | Confirmed (HTTP smoke test) |
| SSRF checked | Confirmed: server makes no outbound requests to user-supplied URLs |
| File upload security | Unknown: not built |
| API input validation | Confirmed for built endpoints |
| Rate limiting | Risk: per-instance only; edge WAF required |
| Sensitive info removed from logs/errors | Confirmed for built code |
| Database permissions / immutability | Confirmed |
| Storage permissions | Unknown: not built |
| CORS | Confirmed (no CORS headers) |
| Security headers | Confirmed |
| Dependencies reviewed | Confirmed (audit above) |
| CI/CD permissions | Unknown: no pipeline yet |
| Production environment variables | Unknown: no environment yet |
| Payment/webhook security | Not applicable |
| Backup/data exposure | Unknown: not configured |
| AI prompt-injection | Not applicable (no AI features) |
