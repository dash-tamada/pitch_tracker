# Pitch Tracker — Story Pipeline Control Center

Internal system for Tamada Media to track every story from submission through review, CEO/COO approval, OTT platform pitching, development and production.

**Every story must have a traceable journey:** who has it → at which level → since when → what they said → what was decided → what happens next.

> Status: **Phases 1–10 built.** Database live on Supabase (Mumbai); Vercel deployment steps in `docs/DEPLOYMENT.md`. Not production-ready until the open items in `SECURITY.md` §12 are closed (malware scanning, email provider, edge rate limiting, first live Storage test).

## Documents

- `docs/ARCHITECTURE.md` — requirements analysis, architecture, ER diagram, RBAC, workflow state machine, API, cloud design, security risks, open business questions
- `SECURITY.md` — what is implemented, what is tested, what is still missing
- `docs/DEPLOYMENT.md` — Supabase + Vercel production setup, first Super Admin, smoke test

## Stack

Next.js 16 (App Router) · React 19 · TypeScript 6 (strict) · PostgreSQL 16+ (Supabase runs 17) · Drizzle ORM · Zod · argon2id · Supabase Storage · Vitest · Playwright. Node.js ≥ 22.12.

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
      creators/ pitches/ ratings/ documents/ storage/ platforms/ production/
      analytics/ reports/ search/ filters/ notifications/ users/ admin/ jobs/ settings/
  app/api/cron/run          daily scheduled jobs (Bearer CRON_SECRET)
drizzle/                    SQL migrations: 0001 triggers + grants, 0002 Supabase hardening,
                            0003 uploads, 0004 storage bucket, 0005 extensions access
scripts/                    migrate, seed, create-super-admin, seed-demo
tests/unit, tests/integration, e2e/ (Playwright against a production build)
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
-- lets the migrator set pitch_app's search_path without inheriting its privileges (PostgreSQL 16+)
GRANT pitch_app TO pitch_migrator WITH ADMIN OPTION, INHERIT FALSE, SET FALSE;
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

Super Admin, Admin, CEO and COO must set up an authenticator app (TOTP) before they can act.

### 6. Optional demo data (development/staging only)
```bash
DEMO_USER_PASSWORD='Demo-Something-2026!' npm run db:seed:demo
```
Creates Employee A/B/C, Senior Employee, CEO, COO, Admin, Viewer (`<name>@demo.example.test`), 13 fictional creators, and pitches in several stages — including **The Last Journey** taken all the way to Production through the real workflow engine. The script refuses to run when `APP_ENV=production`.

### 7. Run
```bash
npm run dev                 # http://localhost:3000
```

### 8. Test
```bash
npm test                    # unit + integration (recreates pitch_test each run)
npm run typecheck
npm run build
npm run test:e2e            # builds, starts on :3100 against pitch_e2e, drives Chromium
```
Integration tests need `TEST_DATABASE_URL` and `TEST_MIGRATION_DATABASE_URL`; the setup refuses to reset any database whose name does not contain "test".

## Environments

| | Development | Staging | Production |
|---|---|---|---|
| Data | Synthetic demo seed | Synthetic only | Real — never copied down |
| Database | Local PostgreSQL | Separate Supabase project | Supabase `pitch-tracker` (ap-south-1) |
| Files | In-memory (`ALLOW_MEMORY_STORAGE=1`) or Supabase | Separate bucket/project | Supabase private bucket `pitch-files` |
| Secrets | `.env.local` (git-ignored) | Vercel Preview env vars | Vercel Production env vars, rotated |
| Deploys | Manual | Vercel preview from branches | Vercel from protected `main` after CI passes |
| `APP_ENV` / `NODE_ENV` | development | staging / production | production / production |

Production deploy order: CI green → `npm run db:migrate` with the migration role (only when `drizzle/` changed) → merge to `main` (Vercel deploys) → smoke test. Full steps: `docs/DEPLOYMENT.md`.

## Roadmap

| Phase | Scope | Status |
|---|---|---|
| 1 | Architecture, database, auth, RBAC, workflow engine, basic UI | Done |
| 2 | Creator management, profiles, projects, ratings | Done |
| 3 | Pitch management, private file storage, script versioning, images | Done (no malware scanning) |
| 4 | Assign/forward/accept/reject/request changes, remarks, timeline, "Where is this story now?" | Done |
| 5 | CEO/COO desk and management views | Done |
| 6 | Platforms, contacts, platform pitches, responses, follow-ups | Done |
| 7 | Development and production trackers | Done |
| 8 | Dashboard, analytics, global search, saved filters, reports, CSV exports | Done |
| 9 | Security hardening, E2E tests, CI | Done — open items in `SECURITY.md` §12 |
| 10 | Production deployment | Database live on Supabase; Vercel setup is yours (`docs/DEPLOYMENT.md`) |

## Pushing code to GitHub

First time (create an empty **private** repository on GitHub first, without a README):
```bash
git init
git add .
git status                  # confirm .env.local is NOT listed
git commit -m "Pitch Tracker"
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
