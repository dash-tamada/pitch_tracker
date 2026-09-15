# Security Model — Pitch Tracker

Status: **Phases 1–10 built; database deployed to Supabase (project `pitch-tracker`, region ap-south-1 Mumbai, PostgreSQL 17). Not yet production-ready** — the open items in §12 must be closed first. This document separates what is implemented and tested from what is designed, missing, or still unverified. Do not describe the application as "secure" or "production-ready" until every applicable item in §12 is Confirmed.

No system is hack-proof. The approach is defence-in-depth: every control below assumes the one before it might fail.

Reporting a vulnerability: email `[PLACEHOLDER: security contact]` — do not open a public issue.

---

## 1. Authentication

| Control | Status |
|---|---|
| Passwords hashed with argon2id (m=19 MiB, t=2, p=1), max 128 chars to bound hashing cost | Implemented, tested |
| Password policy: ≥12 chars, character mix unless ≥16, common-password and email-name checks | Implemented, tested |
| Opaque 256-bit session tokens; only HMAC-SHA256(pepper, token) stored | Implemented, tested |
| Cookie: `__Host-` prefix, `HttpOnly`, `Secure`, `SameSite=Lax` in production | Implemented, verified in E2E |
| Session expiry: 12 h absolute, 30 min idle; logout revokes server-side | Implemented, tested |
| Disabled/archived users lose access on next request | Implemented, tested |
| Account lockout: 5 consecutive failures → 15 min; IP throttling (DB-backed, cross-instance) | Implemented, tested |
| Same error for unknown email and wrong password; dummy hash equalises timing | Implemented, tested |
| TOTP MFA (RFC 6238), secret AES-256-GCM encrypted, replay protection | Implemented, tested (unit + E2E enrolment) |
| MFA mandatory for Super Admin, Admin, CEO, COO — forced enrolment at login | Implemented, tested |
| New users: Admin creates account → single-use set-password link (token in URL fragment, never sent to server logs) | Implemented, tested |
| Forgot/reset password: single-use hashed token, 30 min, same response for unknown emails | Implemented, tested. **Risk:** email delivery is log-only until a provider is configured — reset emails are not actually sent |
| Sessions revoked when a user's roles, clearance or status change | Implemented, tested |
| Sign-in method | `Unknown:` email + password + authenticator app assumed; Google Workspace SSO not built — decision pending |

## 2. Authorization

Three layers, all server-side — hiding a button is never a control.

1. **Role → permission** (`roles`, `role_permissions`, `user_roles`; defaults in `src/server/modules/authz/permissions.ts`).
2. **Resource policy** (`canViewPitch` + its SQL twin `pitchVisibilityCondition`): need-to-know (owner, participant, or `pitch.view_all`) **and** clearance ≥ pitch confidentiality. Denied access returns **404**, so IDs cannot be probed. Lists, search, dashboards, reports and exports use the same SQL condition.
3. **Workflow rules** (`src/server/modules/workflow/rules.ts`): transition must exist for the stage in the pitch's pinned workflow version; permission, roles, current-owner, required fields, recipient eligibility, self-approval policy and optimistic version are checked. Platform, development and production transitions run only through their tracker services.

Separation of duties: **Admin cannot read pitches or scripts**. Admin cannot grant admin-level permissions, edit their own role, or create/modify Super Admins or RESTRICTED clearance; the last Super Admin cannot be removed. Relaxing approval rules is Super Admin only.

Tested abuse cases (`tests/integration/*.test.ts`, `e2e/app.spec.ts`): IDOR on pitches, timelines, documents, versions, uploads and platform pitches (service level; pitch detail also over HTTP in E2E); Admin reading pitches; list-filter parity with the policy; skipping stages; bypassing tracker services through the generic action endpoint; mass assignment; stale concurrent actions; self-approval; clearance escalation; self-privilege escalation; exec without MFA.

## 3. Workflow and data integrity (enforced inside PostgreSQL)

| Invariant | Mechanism | Status |
|---|---|---|
| Workflow history, platform responses, ratings, audit logs, download logs, scan results, dev/prod updates cannot be edited or deleted | `BEFORE UPDATE OR DELETE` triggers (block even the owner) + app role has only `SELECT, INSERT` | Implemented, tested as app role and owner |
| Script versions immutable (only a PENDING scan result may change once) | Trigger `document_versions_guard` | Implemented, tested |
| Rejection needs category + reason; forward needs recipient; platform approval names platform | `CHECK` constraints + engine validation | Implemented, tested |
| Pitches cannot be hard-deleted | Trigger + no `DELETE` grant | Implemented, tested |
| Workflow definitions in use cannot be edited in place | Trigger `workflow_config_guard`; changes publish a new version | Implemented, tested |
| App role cannot run DDL, disable triggers, or bypass RLS | Separate migrator; `pitch_app` is not superuser and lacks BYPASSRLS | Confirmed on Supabase (catalog check, 15 Sep 2026) |
| Trigger functions immune to search_path hijacking | `SET search_path = ''` | Implemented, tested; Supabase security advisor: 0 findings |
| Current stage/owner derivable from history | `foldEvents` + daily `reconcileProjections` job (drift is audited) | Implemented, tested |

## 4. Supabase-specific hardening

Supabase exposes the `public` schema through its Data API to `anon`, `authenticated` and `service_role`, and by default grants them every new table. This app never uses the Data API.

| Control | Status |
|---|---|
| All API-role privileges on tables, sequences and functions revoked, including default privileges for future objects | Confirmed on Supabase: 0 grants (15 Sep 2026); regression-tested locally with emulated roles |
| RLS enabled on all 41 tables; only policy is `app_server_only` for `pitch_app` | Confirmed on Supabase; security advisor 0 findings |
| `pitch_app` can use `pg_trgm` in the `extensions` schema (migration 0005) | Confirmed on Supabase (catalog); guarded by a test that fails without the migration |
| Service/secret key used server-side only, for Storage; never `NEXT_PUBLIC_` | Implemented; CI fails if any `NEXT_PUBLIC_` secret-like variable appears |
| Database connection verifies the server certificate (`DATABASE_CA_CERT`); startup refuses a remote DB without it in staging/production | Implemented, unit-tested. `Unknown:` not yet tried against the live pooler — needs the real password and CA |
| Storage bucket `pitch-files` is private (`public = false`), 50 MB cap, MIME allowlist | Confirmed on Supabase |

## 5. API security

| Control | Status |
|---|---|
| Zod `.strict()` schemas — unknown keys rejected | Implemented, tested |
| JSON body cap 1 MB; prototype-pollution keys rejected | Implemented, tested |
| CSRF: Origin must equal `APP_ORIGIN` + double-submit token | Implemented, tested (E2E) |
| Rate limiting on every route | **Risk:** in-memory per instance; serverless instances do not share it. Login throttling is DB-backed and unaffected. Add Vercel Firewall / WAF rate rules before go-live |
| Safe errors: `{code, message}` only; 500s get a request ID; DB error text never logged | Implemented |
| Cron endpoint requires `Authorization: Bearer CRON_SECRET` (≥32 chars), constant-time compare; closed when the secret is unset or short | Implemented, tested |
| SQL only via parameterized Drizzle queries | Implemented; injection test passes |
| CORS: no CORS headers sent | Implemented (default) |

## 6. Security headers

`Content-Security-Policy` with per-request nonce and `strict-dynamic`, no inline styles, `object-src 'none'`, `frame-ancestors 'none'`, `upgrade-insecure-requests` on HTTPS; HSTS (2 years, preload); `nosniff`; `X-Frame-Options: DENY`; strict referrer; restrictive `Permissions-Policy`; COOP; no `X-Powered-By`; API `Cache-Control: no-store`. Verified on the production build — the E2E run fails on any CSP violation.

## 7. File security

| Control | Status |
|---|---|
| Private bucket; server-generated keys (no user input in paths) | Implemented, tested |
| Upload intent → browser uploads to a one-time signed URL in `quarantine/` → server validates → moves to final key | Implemented, tested with in-memory storage |
| Content validated by magic bytes, not extension or browser MIME; allowlist PDF, DOC, DOCX, TXT, PPT, PPTX, JPG, PNG, WEBP; **no SVG** | Implemented, tested (disguised files rejected) |
| DOCX/PPTX containing macros (`vbaProject.bin`) rejected | Implemented, tested |
| SHA-256 stored per version; versions immutable | Implemented, tested |
| Downloads: permission + resource check → access-log row + audit → 60-second signed URL, forced download | Implemented, tested |
| **Malware scanning** | **Not built.** Files are stored as `NOT_SCANNED` and remain downloadable. Legacy DOC/PPT macros are not inspected. Add a scanning service before handling files from untrusted creators at scale |
| Real Supabase Storage calls (signed upload, move, signed download) | `Unknown:` adapter written against storage-js 2.116.0 endpoints; not yet exercised against the live project |

## 8. Personal data

- Creator mobile/email masked server-side without `creator.view_pii` — in screens, API and CSV exports. Tested.
- Audit payloads pass through `redact()`; long text is recorded as a character count. Tested.
- Login attempts store an HMAC of the email.
- Notifications carry the pitch title only; email jobs carry a notification ID, never script or synopsis text. Reset tokens are cleared from the outbox after sending.
- Website/social links are stored and displayed only; the server never fetches user URLs (no SSRF surface).
- CSV exports neutralise formula injection, need `data.export`, cap at 50 000 rows and are audited with filters and row count.
- Retention job: expired sessions deleted after 7 days, login attempts after 90 days, abandoned uploads removed. `Unknown:` retention periods for creator data under the DPDP Act 2023 — decide with legal counsel.

## 9. Secrets management

- No secrets in source. `.env.example` has placeholders only; `.env*` is git-ignored; CI runs gitleaks over full history.
- Required in production (Vercel → Project → Settings → Environment Variables, Production scope only): `DATABASE_URL`, `DATABASE_CA_CERT`, `SESSION_TOKEN_PEPPER`, `MFA_ENCRYPTION_KEY`, `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `CRON_SECRET`, `APP_ORIGIN`, `APP_ENV`. `MIGRATION_DATABASE_URL` belongs only where migrations run, never in the app's runtime environment. Separate values per environment.
- The Supabase database password and `pitch_app` password are set by the owner in the Supabase dashboard — never pasted into chat, tickets or code.
- If any secret leaks: rotate it, then purge from Git history. Rotating `SESSION_TOKEN_PEPPER` logs everyone out; rotating `MFA_ENCRYPTION_KEY` requires re-enrolling MFA (re-encryption script not built).

## 10. Audit logging

`audit_logs` is append-only. Recorded: sign-in, failures, lockout, rate limiting, logout, MFA enrolment/verification/failure, password change and reset requests, user creation and reset-link issue, permission changes, settings and rating-category changes, workflow version publishing, creator create/edit/photo/projects, pitch create/edit, every workflow action, uploads rejected, images uploaded, current-version changes, downloads, platform/contact changes, platform pitches and responses, follow-ups, ratings, development and production changes, greenlight, exports, and projection drift.

## 11. Backups, monitoring & incident response

- `Unknown:` backup schedule and point-in-time recovery depend on the Supabase plan — check Project → Database → Backups; PITR is a paid add-on. Run a restore test into a separate project before go-live and record the result.
- `Unknown:` no error monitoring configured (no Sentry DSN).
- Incident steps: contain (`UPDATE sessions SET revoked_at = now()`; disable accounts), preserve audit and download logs, rotate secrets, assess personal-data exposure and notify as legally required, post-mortem.

## 12. Release gate (15 Sep 2026)

| Item | Status |
|---|---|
| No secrets hard-coded or exposed | Confirmed (repo scan; CI gitleaks) |
| No production credentials in Git | Confirmed |
| Authentication verified | Confirmed (tests + E2E). Risk: reset emails not delivered until email provider configured |
| Authorization verified | Confirmed for all built endpoints |
| IDOR/BOLA checked | Confirmed |
| SQL/injection checked | Confirmed |
| XSS checked | Confirmed: React escaping + nonce CSP; E2E fails on any CSP violation |
| CSRF checked | Confirmed |
| SSRF checked | Confirmed: no outbound requests to user-supplied URLs; Storage host is fixed by env |
| File upload security | Risk: no malware scanning; live Supabase Storage untested |
| API input validation | Confirmed |
| Rate limiting | Risk: per-instance only; edge rate rules required |
| Sensitive info removed from logs/errors | Confirmed |
| Database permissions / RLS | Confirmed on Supabase |
| Storage permissions | Confirmed: private bucket; access only via server-signed URLs |
| CORS | Confirmed |
| Security headers | Confirmed |
| Dependencies reviewed | Confirmed: `npm audit --omit=dev` in CI |
| CI/CD permissions | Confirmed: workflow token `contents: read` |
| Production environment variables | Unknown: Vercel project not yet configured |
| Database TLS verification | Unknown: implemented, not yet tested against live Supabase |
| Payment/webhook security | Not applicable |
| Backup/data exposure | Unknown: Supabase plan backups not checked |
| AI prompt-injection | Not applicable (no AI features) |
