# Pitch Tracker — Story Pipeline Control Center

Internal system for Tamada Media to track every story from submission through review, CEO/CBO approval, OTT platform pitching, development and production.

**Every story must have a traceable journey:** who has it → at which level → since when → what they said → what was decided → what happens next.

> Status: **Phase 1 foundation** (architecture, database, authentication, RBAC, workflow engine, basic UI). Not production-ready — see `SECURITY.md` §12 and the roadmap below.

## Documents

- `docs/ARCHITECTURE.md` — requirements analysis, architecture, ER diagram, RBAC, workflow state machine, API, cloud design, security risks, open business questions
- `SECURITY.md` — what is implemented, what is tested, what is still missing

## Stack

Next.js 16 (App Router) · React 19 · TypeScript 6 (strict) · PostgreSQL 16 · Drizzle ORM · Zod · argon2id · Vitest. Node.js ≥ 22.12.

## Project layout

```
src/
  app/                      UI pages and thin API route handlers (/api/v1/…)
  proxy.ts                  per-request CSP nonce + CSRF cookie
  server/
    db/schema.ts            all tables, constraints, indexes (source of truth)
    config/                 default workflow, lookups, platforms, settings (seed data)
    lib/                    errors, HTTP wrapper, PII masking, CSV safety, rate limiting
    modules/
      auth/                 login, sessions, lockout, TOTP MFA, password hashing
      authz/                permissions, role matrix, resource access policy
      workflow/             rules (pure) + engine (DB) — the only code that moves a pitch
      audit/                append-only audit log
      creators/  pitches/  settings/
drizzle/                    SQL migrations (0001_integrity.sql = triggers + grants)
scripts/                    migrate, seed, create-super-admin, seed-demo
tests/unit, tests/integration
```

## Local development (Windows, macOS or Linux)

### 1. Install
- Node.js 22.12 or newer
- PostgreSQL 16 (Windows installer from postgresql.org, or Docker: `docker run --name pitch-pg -e POSTGRES_PASSWORD=[PLACEHOLDER] -p 5432:5432 -d postgres:16`)

### 2. Create the two database roles
Run in `psql` as the postgres superuser. Choose your own local passwords.

```sql
CREATE ROLE pitch_migrator LOGIN PASSWORD '[PLACEHOLDER_LOCAL_PASSWORD_1]' CREATEDB;
CREATE ROLE pitch_app      LOGIN PASSWORD '[PLACEHOLDER_LOCAL_PASSWORD_2]';
CREATE DATABASE pitch_dev  OWNER pitch_migrator;
CREATE DATABASE pitch_test OWNER pitch_migrator;
```

`pitch_migrator` runs migrations only. The app always connects as `pitch_app`, which **cannot** alter tables, delete pitches, or edit history.

### 3. Configure
```bash
cp .env.example .env.local        # Windows PowerShell: Copy-Item .env.example .env.local
```
Fill in `.env.local`. Generate the two keys with:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

### 4. Install, migrate, seed
```bash
npm ci
npm run db:migrate          # uses MIGRATION_DATABASE_URL
npm run db:seed             # roles, permissions, workflow, languages, genres, platforms
```
Scripts read environment variables from your shell. On macOS/Linux: `set -a; . ./.env.local; set +a`. On Windows PowerShell load them with `Get-Content .env.local | ForEach-Object { if ($_ -match '^([^#=]+)=(.*)$') { Set-Item "env:$($matches[1])" $matches[2] } }`.

### 5. First Super Admin
```bash
BOOTSTRAP_ADMIN_PASSWORD='choose-a-strong-one' npm run admin:create -- you@tamadamedia.com "Your Name"
```
PowerShell: `$env:BOOTSTRAP_ADMIN_PASSWORD='…'; npm run admin:create -- you@tamadamedia.com "Your Name"; Remove-Item env:BOOTSTRAP_ADMIN_PASSWORD`

Super Admin, Admin, CEO and CBO must set up an authenticator app (TOTP) before they can act.

### 6. Optional demo data (development/staging only)
```bash
DEMO_USER_PASSWORD='Demo-Something-2026!' npm run db:seed:demo
```
Creates Employee A/B/C, Senior Employee, CEO, CBO, Admin, Viewer (`<name>@demo.example.test`), 13 fictional creators, and pitches in several stages — including **The Last Journey** taken all the way to Production through the real workflow engine. The script refuses to run when `APP_ENV=production`.

### 7. Run
```bash
npm run dev                 # http://localhost:3000
```

### 8. Test
```bash
npm test                    # unit + integration (recreates pitch_test each run)
npm run typecheck
npm run build
```
Integration tests need `TEST_DATABASE_URL` and `TEST_MIGRATION_DATABASE_URL`; the setup refuses to reset any database whose name does not contain "test".

## Environments

| | Development | Staging | Production |
|---|---|---|---|
| Data | Synthetic demo seed | Synthetic only | Real — never copied down |
| Database | Local PostgreSQL | Managed, separate account | Managed, Multi-AZ, PITR, encrypted |
| Secrets | `.env.local` (git-ignored) | Secret manager | Secret manager, rotated |
| Deploys | Manual | CI from `main` | CI from protected `main` after staging |
| `APP_ENV` / `NODE_ENV` | development | staging / production | production / production |

Production deploy order: build → `npm run db:migrate` with the migration role (CI job) → `npm run db:seed` (idempotent, config only) → start app with the app role → smoke test. Set `TRUST_PROXY=true` only when running behind your own load balancer.

## Roadmap

| Phase | Scope | Status |
|---|---|---|
| 1 | Architecture, database, auth, RBAC, workflow engine, basic UI | **This delivery** |
| 2 | Creator management, profiles, projects, ratings UI | Next |
| 3 | Pitch management UI, private file storage, script versioning, images | |
| 4 | Assignments, forward/accept/reject/request-changes UI, remarks, timeline, "Where is this story now?" | Engine done; UI next |
| 5 | CEO/CBO management views | |
| 6 | Platform database, contacts, platform pitches, responses, follow-ups | |
| 7 | Development and production trackers | |
| 8 | Dashboard, analytics, global search, filters, reports, exports | |
| 9 | Security hardening, monitoring, backups, full security test pass | |
| 10 | Production deployment | |

## Pushing code to GitHub

First time (create an empty **private** repository on GitHub first, without a README):
```bash
git init
git add .
git status                  # confirm .env.local is NOT listed
git commit -m "Phase 1: architecture, database, auth, RBAC, workflow engine"
git branch -M main
git remote add origin https://github.com/[PLACEHOLDER_ORG]/pitch-tracker.git
git push -u origin main
```

Every later change:
```bash
git status
git add .
git commit -m "Describe the change"
git push
```
