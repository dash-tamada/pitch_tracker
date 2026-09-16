# Multi-Tenant SaaS Conversion — Phase 1 Audit & Phase 2 Design

> **Implementation status (16 Sep 2026):** Phases 1–15 implemented and tested locally — migration `0006_multi_tenant.sql`, tenant-scoped database handles, platform Super Admin console, Company Admin (invitations, email policy, branding, setup), plans & limits, support access, per-company jobs and storage keys, 19 cross-tenant abuse tests, E2E for the platform console. Production upgrade: `deploy/3-multi-tenant-upgrade.sql` + `deploy/4-verify-multi-tenant.sql` (see `docs/DEPLOYMENT.md` §0). Differences from the design below: platforms are company-owned copies linked to `platform_catalog` (D-platforms); exact-address email exceptions are managed by the Company Admin, domains by the platform.


Status: **analysis and design only — no application behaviour changed.** Written 15 Sep 2026 from the code in this repository and the live Supabase project `emtadepabamemdxmumyc`.

Labels: `Confirmed:` verified in this analysis (code read, query run, or prototype test). `Likely (not verified):` reasoning, not tested. `Assumed:` a choice made to proceed — tell Durgaji if wrong. `Unknown:` needs a check.

---

## 0. Decisions that shape everything

| # | Decision | Why |
|---|---|---|
| D1 | **Shared database, `company_id` on every tenant-owned row** (no database-per-company). | 1 → 1,000+ tenants with one schema, one migration path, one backup. Supabase Micro/Small handles this; per-tenant databases multiply cost and ops. |
| D2 | **Tenant isolation enforced inside PostgreSQL with Row-Level Security**, keyed on a transaction-local setting `app.company_id` that only the server sets from the authenticated session. | The code has **345 query sites in 25 service modules and 92 route/page files that open the database directly** (`Confirmed:` counted). Adding `WHERE company_id = …` by hand to each is exactly the "developer forgets once" failure. RLS makes every existing query — including search, analytics, exports, joins and sub-queries — tenant-scoped with no per-query edit, and fails closed. |
| D3 | **`company_id` column defaults to the session tenant**, so existing `INSERT`s keep working unchanged and cannot write into another tenant. | Prototype T5/T7. |
| D4 | **Composite foreign keys `(company_id, x_id) → parent(company_id, id)`** for every tenant relationship. | The database itself refuses "Pitch in Company A → Creator in Company B" (prototype T6), independent of application code. |
| D5 | **Three database roles**: `pitch_app` (company work, RLS-scoped, no platform tables), `pitch_platform` (identity + platform admin, **no grants on customer content tables**), `pitch_migrator` (DDL only). Platform usage numbers come from `SECURITY DEFINER` functions that return counts only. | Implements §73 "Platform Management Access ≠ Customer Content Access" as a database permission, not a UI rule (prototype T9/T10). |
| D6 | **Application layer still resolves tenant context centrally** (`resolveTenantContext()` → `withTenant()`), and service lookups keep their existing permission/policy checks. | Defence in depth: RLS is the backstop; services still return clean 404/403 and enforce role permissions. |
| D7 | **Global platform master + per-company platform configuration** (`platforms` + `company_platforms`); contacts, pitch history and responses are company-owned. | §22/§64. |
| D8 | **One user belongs to one company** (email globally unique for sign-in). Platform staff have `scope = PLATFORM` and `company_id = NULL`. No company switching. | §76. Keeps the session → tenant mapping unambiguous. |
| D9 | **Existing data becomes tenant #1 "Tamada Media"**; existing `SUPER_ADMIN` role holders become **Company Admin** of Tamada Media, not platform Super Admin. The platform Super Admin is a separate account created by a script. | §63. `Assumed:` durgaji@tamadamedia.com stays Tamada Media's Company Admin; a separate platform-owner login is created — tell me if wrong. |
| D10 | Role names: keep **COO** (not CBO). | You previously renamed CBO → COO everywhere (`Given:`). The brief says CBO; the role key is configurable per company, so either label works. `Assumed:` keep COO — tell me if wrong. |

### Prototype results (the critical point, tested twice: SQL prototype now, full test-suite in Phase 12)

Scratch PostgreSQL 16 database; two companies A and B; a company-scoped role behaving like `pitch_app`; a platform role like `pitch_platform`. All `Confirmed:`

| Test | Expected | Result |
|---|---|---|
| T1 Company A lists creators and pitches | only A's rows | 1 creator, 1 pitch |
| T2 A reads B's pitch by its UUID | nothing | 0 rows |
| T3 A searches for B's creator name | nothing | 0 rows |
| T4 A updates B's pitch | no change | 0 rows updated; B's title unchanged |
| T5 A inserts a pitch claiming `company_id = B` | refused | `violates row-level security policy` |
| T6 A links its pitch to B's creator | refused | composite foreign key violation (and no existence leak — the key probed is A's own) |
| T7 Query with no tenant context | read nothing, write nothing | 0 rows; insert refused |
| T8 Tenant context after the transaction ends | gone | 0 rows in next transaction on same connection |
| T9 Platform role reads content table | refused | `permission denied for table pitches` |
| T10 Platform role reads usage | counts only | per-company counts returned |

T8 matters for Supabase: the app uses the **transaction pooler**, which hands a connection to one transaction at a time; a transaction-local setting cannot leak to another company's request. `Likely (not verified):` identical behaviour through Supavisor — verified in Phase 12 against a Supabase branch/staging project.

---

## 1. Current architecture (answers to §96)

| # | Question | Answer (`Confirmed:` from code unless labelled) |
|---|---|---|
| 1 | Framework | Next.js 16.3.5 App Router, React 19.3, TypeScript 6 strict; server-side services in `src/server/modules/*`; thin route handlers in `src/app/api/**/route.ts` wrapped by `route()` in `src/server/lib/http.ts`. |
| 2 | Database | PostgreSQL 17 on Supabase (ap-south-1), Drizzle ORM 0.45.2, SQL migrations `drizzle/0000–0005`. Local/CI PostgreSQL 16. |
| 3 | Authentication | Custom: email + argon2id password, opaque 256-bit session token (HMAC-peppered hash in `sessions`), `__Host-` HttpOnly cookie, TOTP MFA mandatory for Super Admin/Admin/CEO/COO, lockout + DB-backed IP throttling, set-password and reset tokens (`password_reset_tokens`). No Supabase Auth. |
| 4 | Users | `users` table (email globally unique, status, clearance, MFA fields). No company column. |
| 5 | Roles | `roles` (7 global rows: SUPER_ADMIN, ADMIN, SENIOR_EMPLOYEE, EMPLOYEE, CEO, COO, VIEWER), `user_roles`. Global key uniqueness (`roles_key_uq`). |
| 6 | Permissions | `permissions` catalog (38 keys, e.g. `pitch.create`, `document.download`), `role_permissions`; defaults in `src/server/modules/authz/permissions.ts`. UI reads permissions from the server; no permission logic hard-coded in components. `SUPER_ADMIN` referenced 18 times in 6 files. |
| 7 | Pitches | `pitches` (31 columns) with projection of current stage/owner; `pitch_participants`; human code `pitch_code` globally unique via `pitch_code_counters`. |
| 8 | Creators | `creators` (mobile/email unique **globally**), `creator_projects`, ratings in `ratings` + `rating_scores`. |
| 9 | Files | Supabase Storage private bucket `pitch-files` via REST adapter (`storage/supabase.ts`); keys server-generated: `quarantine/<uuid>.<ext>`, `creators/<creatorId>/photo-<uuid>`, document/image keys; metadata in `documents`, `document_versions`, `pitch_images`, `upload_intents`; downloads = DB lookup + access log + 60 s signed URL. |
| 10 | Workflow state | `workflow_definitions` (versioned, **one active globally**), `workflow_stages`, `workflow_transitions`; append-only `workflow_events`; pitch row holds projection. |
| 11 | Audit | `audit_logs` (append-only trigger), `document_access_logs`. |
| 12 | APIs | 71 route files: 70 under `/api/v1/**` plus `/api/cron/run`. |
| 13 | Routes (pages) | 26 pages: `(app)/dashboard, pitches, creators, reviews, management, platforms, development, production, analytics, notifications, search, users, settings, account`, plus login/set-password/forgot-password/mfa-setup. |
| 14 | Cloud | Supabase (Postgres, Storage), Vercel (planned, `bom1`), GitHub Actions CI. No cache service, no queue (DB outbox), email log-only. |
| 15 | Tables needing tenant ownership | §3 below (35 of 41 tables). |
| 16 | Relationships needing tenant validation | §3.3 below (70 of the 75 foreign keys). |
| 17 | APIs that would allow cross-tenant IDOR once a 2nd company exists | Every route with an `[id]`/`[key]`/`[token]` segment (36 of 71 routes) and every list/search/report/export route — because no query is tenant-scoped today. §4. |
| 18 | File endpoints that could expose data | §5. |
| 19 | Existing data migration | §7. |
| 20 | Safest plan | §7.4 + §9. |

### Current single-tenant protections that carry over
Need-to-know pitch policy (`canViewPitch` + SQL twin), clearance levels, workflow rules, immutability triggers, CSRF, CSP nonce, PII masking, CSV injection guard, macro/magic-byte upload validation, 143 automated tests + 5 E2E. These keep working **inside** each tenant.

### Gaps specific to multi-tenancy (`Confirmed:` by reading the code)
- `resolveSession()` / `loadActor()` return roles and permissions but **no company** (`authz/actor.ts`).
- `getSettings`, `getLookups`, `getActiveWorkflow`, rating categories, platforms are **singletons** (one row set for the whole database).
- Unique constraints that would collide between companies: `pitches_code_uq`, `creators_mobile_uq`, `creators_email_uq`, `roles_key_uq`, `rating_categories_key_uq`, `lookup_type_key_uq`, `workflow_def_one_active_uq`, `workflow_def_version_uq`, `platforms_name_uq`.
- Background jobs (`jobs/runner.ts`: outbox, follow-ups, aging, reconcile, retention) scan **all** rows.
- No data caches exist (`Confirmed:` no `unstable_cache`, `"use cache"`, `revalidate` in `src`). The in-memory rate limiter is keyed by IP + path (not tenant data), so nothing cached can leak between tenants today; Phase 5 adds company to rate-limit keys for per-tenant fairness.

---

## 2. Target architecture

```
                         ┌──────────── pitch_platform (no content grants) ─────────────┐
 Browser ── /super-admin/*│ platform auth · companies · plans · subscriptions · platform │
                         │ audit · usage via SECURITY DEFINER count functions            │
                         └───────────────────────────────────────────────────────────────┘
 Browser ── /app/* ── route() ── resolveTenantContext() ── withTenant(companyId) ──┐
                         (session → user → company → status → roles → permissions) │
                                                                                     ▼
                         BEGIN; SET LOCAL ROLE-scoped conn pitch_app; set_config('app.company_id', <from session>, true)
                         existing services run unchanged → RLS filters every read/write → COMMIT
```

### 2.1 Tenant context (server only)
`resolveTenantContext(sessionToken)` → `{ userId, scope: 'PLATFORM'|'COMPANY', companyId|null, companyStatus, roles, permissions, clearance, mfaSatisfied, supportGrant? }`.
- Company users: `companyId` comes from `users.company_id` read by `pitch_platform`. **Never** from body, query, URL, header, cookie or local storage. Any `company_id`/`companyId` key in a request body is rejected by the existing `.strict()` schemas.
- `withTenant(ctx, fn)` opens a transaction on the `pitch_app` pool, runs `select set_config('app.company_id', $1, true)` with a bound parameter, then `fn(tx)`.
- Guards: `requireCompanyAccess()` (scope COMPANY, company ACTIVE/TRIAL), `requirePermission(key)`, `requirePlatformRole('SUPER_ADMIN')`.
- Static test: no file under `src/app/(app)` or `src/app/api/v1` may call `getDb()` directly; they receive the tenant transaction from `route()` / `requireCompanyPage()`.

### 2.2 Accounts, scopes and roles
| Scope | Who | company_id | Roles |
|---|---|---|---|
| PLATFORM | SaaS operator staff | NULL | `SUPER_ADMIN` (fixed platform permission set; MFA mandatory; 4 h absolute session; re-auth for sensitive actions) |
| COMPANY | Customer staff | required | Per-company configurable roles, seeded: COMPANY_ADMIN, ADMIN (config, no content), SENIOR_EMPLOYEE, EMPLOYEE, CEO, COO, VIEWER |

- `permissions.scope` ∈ {PLATFORM, COMPANY}. A trigger rejects linking a PLATFORM permission to a company role — Company Admin cannot grant platform powers even by crafting API calls.
- New company permissions: `company.manage_settings`, `company.manage_users`, `company.manage_roles`, `company.manage_email_policy_exceptions`, `company.view_audit`, `company.view_usage`, `user.reassign_work`. Existing 38 keep their names.
- CHECK constraint: `scope='PLATFORM' ⇔ company_id IS NULL`.

### 2.3 Company lifecycle & status gate
`companies(id, code UNIQUE, name, legal_name, logo_key, website, industry, country, state, city, address, contact_person, contact_phone, primary_email, brand_primary_color, status, created_at, suspended_at, archived_at, retention_until)`; `status` ∈ ACTIVE, TRIAL, SUSPENDED, EXPIRED, PENDING_SETUP, ARCHIVED.
- Session resolution blocks company content when status ∉ {ACTIVE, TRIAL}; suspension also revokes all company sessions. Data is never deleted by status changes.
- Deletion = ARCHIVED + retention period; hard delete only through a separate scripted, re-authenticated, audited procedure (not in the UI).

### 2.4 Provisioning (`provisionCompany`) — one transaction
Creates company → email policy → Company Admin user (status INVITED, no password) → invitation token → default roles/permissions → default workflow (from `config/default-workflow.ts`) → lookups (languages, genres, formats, rejection categories, etc.) → rating categories → settings → `company_platforms` rows for the 10 master platforms → trial/plan subscription → platform audit event. Replaces today's global `seedConfig`.

### 2.5 Invitations & email policy
- `user_invitations(company_id, user_id, token_hash, expires_at, used_at, revoked_at, invited_by)`: 256-bit random token, only SHA-256/HMAC hash stored, 72 h default expiry (configurable), single use, invalidated on activation/resend; token in URL fragment (as today's set-password).
- `company_email_policies(company_id, mode: DOMAIN|EXACT|BOTH)`, `company_allowed_domains(company_id, domain)`, `company_allowed_emails(company_id, email, reason, approved_by, approved_at)` for exceptions. Enforced in the invite/create-user service; exceptions require `company.manage_email_policy_exceptions` (Super Admin by default) and write an audit event.

### 2.6 Plans, subscriptions, usage (billing-ready, no payment provider)
`plans(key, name, limits jsonb)` e.g. `{"max_users":10,"storage_bytes":107374182400,"max_file_bytes":52428800}` — **no hard-coded values in code**; `subscriptions(company_id, plan_key, status TRIAL|ACTIVE|PAST_DUE|SUSPENDED|EXPIRED|CANCELLED, starts_on, ends_on, external_ref)`; `subscription_events`; `usage_records(company_id, period, metric, value)`.
Enforcement in services within the tenant transaction, locking the company row (`FOR UPDATE`) so two concurrent invites cannot both pass a limit. Storage usage = sum of `document_versions.size_bytes` + `pitch_images.size_bytes` per company.

### 2.7 Super Admin content boundary & support access
- `pitch_platform` has **no SELECT** on pitches, documents, versions, images, creators, ratings, remarks, platform contacts/pitches/responses, notifications.
- Usage & dashboards via `platform_company_usage()` etc. (counts/sums only).
- Temporary support access: `support_access_grants(company_id, platform_user_id, reason NOT NULL, starts_at, expires_at ≤ 60 min default, revoked_at)`. While active, the platform user may call `withTenant` for that company with a **read-only support permission set**; every request writes a company audit event visible to the Company Admin; auto-expires; no hidden impersonation.

### 2.8 Audit
`audit_logs.company_id` NULL for platform events. `pitch_app` policy: own company only. `pitch_platform` policy: `company_id IS NULL` rows only (platform audit) — company audit stays with the company unless under support access. Every log line gains `company_id` + `request_id` (internal logs never shipped to customers).

### 2.9 Storage
New keys: `company/{companyId}/pitches/{pitchId}/docs/{uuid}`, `company/{companyId}/pitches/{pitchId}/images/{uuid}`, `company/{companyId}/creators/{creatorId}/photo-{uuid}`, `company/{companyId}/quarantine/{uuid}`, `company/{companyId}/branding/logo-{uuid}`. Keys are still server-generated; signed URLs are issued only after the RLS-scoped row lookup succeeds (a company B document id returns "not found" before any key is known). Bucket stays private. `Unknown:` whether any objects exist in production yet — resolve with Storage → pitch-files listing; if any, migration moves them (§7.3).

### 2.10 Background jobs
Cron (`pitch_platform`) lists companies with status ACTIVE/TRIAL, then runs each job **per company inside `withTenant`**. Outbox rows carry `company_id`; the sender re-checks that the recipient user belongs to that company before sending. Global-by-design jobs (session/login-attempt clean-up) run on identity tables only.

### 2.11 Branding
`companies.logo_key`, `brand_primary_color` (validated `#RRGGBB`), favicon key. CSP forbids inline style attributes, so brand colours are emitted as CSS custom properties in a nonce'd `<style>` element. `Likely (not verified):` works with the existing nonce CSP — checked by the E2E CSP-violation test.

### 2.12 Routes & navigation
- `/super-admin/{dashboard,companies,companies/[id],subscriptions,plans,users,security,audit,settings}` — platform scope only; separate layout.
- `/app/*` — company scope; existing pages move from `(app)/` under `/app` (redirects from old paths). Company admin pages: `/app/users`, `/app/company-settings`, `/app/workflow-settings`, `/app/platform-settings`, `/app/audit`, `/app/setup` (first-login wizard).
- `/login` routes by scope/role after authentication. No `/company/:id` security boundary; any id in a URL is re-checked by RLS.

---

## 3. Database changes

### 3.1 Table classification (41 tables, `Confirmed:` inventory)

| Class | Tables | Change |
|---|---|---|
| **New platform tables** | `companies`, `plans`, `subscriptions`, `subscription_events`, `usage_records`, `support_access_grants`, `company_email_policies`, `company_allowed_domains`, `company_allowed_emails`, `company_platforms`, `user_invitations` | create; `company_platforms`, email policy tables and `user_invitations` are company-scoped (RLS) |
| **Identity (global, platform role)** | `users` (+`company_id`, `scope`), `sessions` (+`company_id` snapshot), `login_attempts`, `password_reset_tokens` (+`company_id`) | auth runs before tenant context, via `pitch_platform`; `pitch_app` sees only its company's users |
| **Global catalog (read-only to companies)** | `permissions` (+`scope`), `platforms` (master) | no tenant column |
| **Tenant-owned — add `company_id NOT NULL` + RLS + composite keys** (35) | `audit_logs`*, `creator_projects`, `creators`, `development_projects`, `development_updates`, `document_access_logs`, `document_scan_results`, `document_versions`, `documents`, `follow_ups`, `job_outbox`, `lookup_values`, `notifications`, `pitch_code_counters`, `pitch_images`, `pitch_participants`, `pitches`, `platform_contacts`, `platform_pitches`, `platform_responses`, `production_projects`, `production_updates`, `rating_categories`, `rating_scores`, `ratings`, `role_permissions`, `roles`, `saved_filters`, `system_settings`, `upload_intents`, `user_roles`, `workflow_definitions`, `workflow_events`, `workflow_stages`, `workflow_transitions` | *`audit_logs.company_id` nullable for platform events |

### 3.2 Uniqueness (§78)
Global: `users.email`, `companies.code`, storage keys, session/invitation token hashes.
Per company: `(company_id, pitch_code)`, `(company_id, mobile_e164)`, `(company_id, email_normalized)` on creators, `(company_id, key)` roles/rating categories, `(company_id, type, key)` lookups, `(company_id, name, version)` workflow definitions, one active workflow per company `(company_id) WHERE is_active`, `(company_id, platform_id)` company platforms. Every tenant parent also gets `UNIQUE (company_id, id)` as the target for composite FKs.

Human IDs (§79/80): `pitch_code_counters(company_id, year, next)` → `{COMPANY_CODE}-{YYYY}-{000001}`; optional creator code `{CODE}-CR-{000001}`. `Assumed:` existing pitch codes are kept unchanged (they may already be printed or shared) — tell me if wrong.

### 3.3 Tenant-safe relationships (§77) — composite FKs
70 of the 75 foreign keys become `(company_id, child_fk) → parent(company_id, id)`. Highest-risk examples:
`pitches(company_id, creator_id) → creators`, `pitches(company_id, current_owner_id) → users`, `documents(company_id, pitch_id) → pitches`, `document_versions(company_id, document_id) → documents`, `platform_pitches(company_id, pitch_id) → pitches`, `platform_pitches(company_id, platform_id) → company_platforms(company_id, platform_id)`, `platform_pitches(company_id, contact_id) → platform_contacts`, `ratings(company_id, pitch_id) → pitches`, `ratings(company_id, creator_id) → creators`, `workflow_events(company_id, to_owner_id) → users`, `user_roles(company_id, role_id) → roles`, `role_permissions(role_id) → roles` + scope trigger, `notifications(company_id, user_id) → users`, `follow_ups(company_id, assignee_id) → users`, `production_projects(company_id, platform_id) → company_platforms`.
User FKs work because `users` gets `UNIQUE (company_id, id)`; platform users (company_id NULL) can never satisfy a company FK. The other 5 stay simple: 2 to the global `permissions` catalog, 2 identity FKs (`sessions`, `password_reset_tokens` → `users`), and `audit_logs.actor_id` (platform events have platform actors).

### 3.4 Indexes (§89) — from actual query shapes
Replace single-column indexes with company-leading composites where the query filters by it: `pitches (company_id, current_stage_key, stage_entered_at)`, `(company_id, current_owner_id)`, `(company_id, creator_id)`, `(company_id, created_at)`; `creators (company_id, name_normalized gin_trgm)`, `workflow_events (company_id, action, created_at)`, `notifications (company_id, user_id, read_at, created_at)`, `audit_logs (company_id, created_at)`, `platform_pitches (company_id, platform_id, current_status)`, `follow_ups (company_id, due_on) WHERE completed_at IS NULL`. RLS predicates use `(select public.app_company_id())` so PostgreSQL evaluates the setting once per statement.

---

## 4. APIs requiring tenant protection (§93.9)
All 71 route files move behind `withTenant` except: `auth/login`, `auth/logout`, `auth/password/{forgot,reset}`, `auth/mfa/*`, `auth/me` (identity, `pitch_platform`), `cron/run` (per-company fan-out), and new `/api/platform/**` (Super Admin).
Routes with an identifier in the URL (cross-tenant IDOR candidates, each gets a two-tenant test): `pitches/[id]` and its 13 sub-routes (status, archive, documents, images, download-log, ratings, platform-pitches, development, greenlight, production/advance, actions, timeline), `creators/[id]` (+archive, projects, ratings, photo), `creator-projects/[id]`, `document-versions/[id]/{download,access-log}`, `documents/[id]/current`, `uploads/[id]/complete`, `platforms/[id]` (+contacts), `platform-contacts/[id]`, `platform-pitches/[id]/responses`, `follow-ups/[id]/complete`, `development/[id]/updates`, `production/[id]`, `saved-filters/[id]`, `admin/users/[id]` (+reset-link), `admin/roles/[key]`, `dev-storage/{upload,read}/[token]`.
Collection routes (cross-tenant leakage candidates): `pitches`, `creators`, `creators/match`, `search`, `reports`, `exports`, `analytics`, `dashboard/{summary,me,executive}`, `pipeline/{development,production}`, `follow-ups/due`, `notifications`, `users/directory`, `admin/{users,roles,lookups,rating-categories,settings,workflow,audit}`, `platforms`.

## 5. File endpoints (§93.10)
`uploads` (intent), `uploads/[id]/complete`, `document-versions/[id]/download`, `pitches/[id]/documents`, `pitches/[id]/images` (image signed URLs), `creators/[id]/photo`, `dev-storage/{upload,read}/[token]` (development only; already refused when `APP_ENV` is staging/production — `Confirmed:` `memoryStorageAllowed()`), company logo (new). Checks for each: authenticated → tenant resolved → RLS row lookup → permission → short-lived signed URL; key prefix must equal `company/{ctx.companyId}/` (belt-and-braces assertion before signing).

---

## 6. Security risks and mitigations (§93.13)

| Risk | Mitigation | Status |
|---|---|---|
| Developer forgets tenant filter in one of 345 query sites | RLS on all tenant tables; static test that every public table is either allow-listed global or has `company_id` + tenant policy | Design `Confirmed:` by prototype |
| Request sets `company_id` | `.strict()` schemas reject unknown keys; column default + RLS `WITH CHECK` refuses other tenants | Prototype T5 |
| Cross-tenant relationship via foreign id | Composite FKs | Prototype T6 |
| Tenant context leaks between pooled requests | transaction-local setting; one transaction per request unit | T8 `Confirmed:` (plain PG); Supavisor `Likely` |
| Code runs without tenant context | reads return nothing; writes fail | T7 |
| Super Admin browses customer scripts | `pitch_platform` has no content grants; support access time-boxed, reasoned, audited, company-visible | T9/T10 |
| `SECURITY DEFINER` function misuse | `search_path=''`, counts only, `REVOKE ALL FROM PUBLIC`, owned by migrator, reviewed + tested | design |
| FK checks bypass RLS (existence oracle) | composite FK probes only `(own company, id)` | T6 |
| Suspended company keeps sessions | status check on every session resolution + revoke on suspend | design |
| Background job touches all tenants | per-company fan-out under `withTenant`; outbox recipient re-check | design |
| Long uploads hold a tenant transaction open (pool exhaustion) | storage I/O outside the transaction; DB work in short `withTenant` calls | design |
| Company Admin escalates to platform | permission `scope` + trigger; platform roles not in company role table | design |
| Email policy bypass via API | enforced in service; exceptions need platform-granted permission + audit | design |
| Privilege via stale session after role/disable | existing `revokeAllSessions` on access change; extend to company suspend | partly existing (`Confirmed:` users/admin.ts:116) |
| Globally unique login email reveals that an address has an account in another company (invite returns "already in use") | Invite responds identically for new and existing addresses ("Invitation sent if the address is eligible"); the conflict is recorded for Super Admin review, never shown to the company | design |
| Row-level security is the backstop, not the whole job: 345 query sites still need review for per-company logic (counters, settings, uniqueness messages) | Phase 6 reviews every service; tenant suite runs each service as Company A against Company B data | design |
| Migration corrupts production data | backup, staging rehearsal, row-count + checksum verification, single transaction, rollback script | §7 |

---

## 7. Migration strategy (§61–63, §90)

### 7.1 Current production state
Supabase project `emtadepabamemdxmumyc` holds configuration seed only (roles, permissions, workflow v1, lookups, platforms, settings) as of this morning's verification. `Unknown:` whether `npm run setup:local` completed and created a Super Admin user, or whether any pitches/files were created since. Resolve with a read-only count in the SQL editor:
`select (select count(*) from users) users, (select count(*) from pitches) pitches, (select count(*) from documents) docs;`
Converting now, before real customer data exists, is the lowest-risk moment this migration will ever have.

### 7.2 Migration `0006_multi_tenant` (expand) — one transaction
1. Create `companies`, platform/subscription/email-policy/invitation tables; roles `pitch_platform`; helper `app_company_id()`.
2. Insert tenant #1: Tamada Media (`code = 'TAM'`, `Assumed:` code — tell me if wrong), status ACTIVE, plan Enterprise (limits null = unlimited).
3. Add `company_id` **nullable** to the 35 tenant tables; backfill every row with Tamada Media's id; convert `platforms` data into master + `company_platforms` for Tamada (contacts/pitches/responses re-pointed).
4. Map roles: existing SUPER_ADMIN → COMPANY_ADMIN (company scope, all company permissions); ADMIN, SENIOR_EMPLOYEE, EMPLOYEE, CEO, COO, VIEWER unchanged; `users.scope = COMPANY`, `company_id = TAM` for every existing user. **No existing user becomes platform Super Admin.**
5. Verify: count of rows with `company_id IS NULL` = 0 in every tenant table; every composite relationship joins; row counts identical before/after (checksums per table).
6. Set `NOT NULL`, add `UNIQUE (company_id, id)`, swap unique constraints to per-company, add composite FKs (`NOT VALID` then `VALIDATE`), add company-leading indexes, enable tenant RLS policies, replace `app_server_only` policy, grant `pitch_platform` identity/platform tables only.
7. Re-run the security advisor and `deploy/2-verify.sql` (extended with tenant checks).

### 7.3 Storage objects
If §7.1 shows objects: script copies each object to `company/{TAM}/…` key, updates the row, verifies byte size + SHA-256 against `document_versions.sha256`, then removes the old key. Idempotent; resumable.

### 7.4 Rehearsal and rollback (§90)
1. Supabase backup (Database → Backups) + `pg_dump` of the project stored off-site encrypted.
2. Restore the dump into a **local** PostgreSQL 17 and into a separate staging Supabase project/branch; run migration; run full test suite + tenant isolation suite + E2E against staging.
3. Production: maintenance window (no users yet), run migration, verify, smoke test.
4. Rollback: `0006` is transactional (fails → nothing applied); after commit, restore from the backup taken in step 1 (no down-migration that could lose writes).

---

## 8. Test plan (§93.14, §50, §70, §71)

**Fixture:** Company A (Employee A, Company Admin A, Creator A "Ravi Kumar", Pitch A, Script A v1, Platform contact A, rating 4.7 + remark) and Company B with the same creator name, different data; Platform Super Admin P; Support grant G (expired and active variants).

| Layer | Tests |
|---|---|
| Database (SQL, run as each role) | For each of the 35 tenant tables: A cannot select/update/delete B rows; insert with B's `company_id` refused; no-context read = 0, write refused; composite FK rejects cross-tenant links; `pitch_platform` denied on content tables; usage functions return counts only; static catalog test that every table is classified |
| Service | Every service function called as A with B's ids → `NOT_FOUND`; list/search/report/export/analytics as A never contains B ids or names; plan limits (users, storage, file size) under concurrency; email policy allow/deny/exception + audit |
| HTTP (route level) | All 36 id-routes with B's id as A → 404; body/query/header `company_id` injection → 400/ignored; suspended company → 403 with message on every route; platform routes as company admin → 403; company routes as Super Admin without support grant → 403 |
| Files | A downloads B version → 404; A completes B's upload intent → 404; signed URL expires (≥ 61 s) → storage 400/403; public object URL → denied |
| Jobs | Follow-up/aging/outbox for A never create B notifications; outbox recipient in other company is dropped + audited |
| Sessions | Disable user → next request 401; suspend company → all company sessions 401; role change revokes sessions |
| E2E (Playwright) | §71 scenario end-to-end in two browsers; CSP-violation-free with branding |
| Regression | Existing 143 tests + 5 E2E run inside tenant A with no behavioural change |

Release gate: SECURITY.md §12 extended with "Tenant isolation verified (DB, service, HTTP, files, jobs, search, export, analytics)".

---

## 9. Implementation phases and exit checks

| Phase | Scope | Exit check (pass/fail) |
|---|---|---|
| 1 | Audit (this document) | Reviewed by Durgaji |
| 2 | Design (this document) | Decisions D1–D10 accepted |
| 3 | `0006` migration + backfill + tenant #1 | Local restore of production dump migrates; zero NULL `company_id`; row checksums equal; advisor clean |
| 4 | Tenant-aware session/actor (`resolveTenantContext`) | Unit tests; existing auth tests green |
| 5 | `withTenant`, route/page wiring, `pitch_platform` pool | Static "no getDb in company routes" test; all existing tests green |
| 6 | Services: per-company settings/lookups/workflow/platforms/codes, storage prefixes, jobs fan-out | Existing 143 tests green inside tenant A |
| 7 | Super Admin (companies, provisioning, status, plans, usage, platform audit) | Provision → invite → activate flow test |
| 8 | Company Admin (users, roles, reassignment, audit, dashboard, setup wizard) | Admin flows + permission scope trigger tests |
| 9 | Invitations & email policy | Token single-use/expiry/replay tests; policy tests |
| 10 | Company settings & branding | CSP test with branding |
| 11 | Plans/subscriptions/usage enforcement | Concurrency limit tests |
| 12 | Tenant isolation suite (§8) incl. Supabase staging run | All green |
| 13 | Security audit + self-attack | SECURITY.md updated; no open High |
| 14 | Regression (unit, integration, E2E) | All green |
| 15 | Production deployment (§7.4) | Smoke test + verify script PASS |

Git: each phase is a separate commit/PR with its tests.
