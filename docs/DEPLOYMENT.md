# Deployment — Supabase + Vercel

Production stack: **Supabase** (PostgreSQL 17 + private Storage, region ap-south-1 Mumbai) and **Vercel** (Next.js, region `bom1` Mumbai).

Supabase project: `pitch-tracker` · ref `emtadepabamemdxmumyc` · API URL `https://emtadepabamemdxmumyc.supabase.co`

> An earlier copy of this project was created by mistake in a separate Free-plan organization (ref `pxbqaqnzgrstdaoubirr`). It is not used; delete it from that organization's dashboard.

> Secrets in this guide are created and pasted **only** into the Supabase dashboard, Vercel settings, or your own terminal. Never into chat, tickets, email or code.

## Status (15 Sep 2026)

| Step | State |
|---|---|
| Project created in the **Tamada Media (Pro)** organization, Micro compute (~$10/month), healthy | Done |
| Migrations 0000–0005 + configuration + private bucket applied in one transaction from `deploy/1-supabase-setup.sql` (Drizzle journal rows included, so `npm run db:migrate` skips them) | Done |
| `deploy/2-verify.sql` on the live project: 22/22 PASS — schema (columns, constraints, indexes, triggers, enums, grants, RLS policies, functions) and seeded data identical to a locally migrated database; bucket `pitch-files` private | Done |
| Configuration seeded: 38 permissions, 7 roles, 162 role permissions, 74 lookups, 6 rating categories, 10 platforms, 4 settings, workflow v1 (19 stages / 60 transitions). No demo data | Done |
| Security advisor | 0 errors, 0 warnings, 0 suggestions |
| "Automatically expose new tables" disabled at project creation | Done |
| Steps 1–7 below | **Yours to do** |

## 0. Multi-tenant upgrade (September 2026 release)

The production database is still single-company (migrations 0000–0005). This release adds companies. Order matters — do all of it in one sitting:

1. **Backup.** Supabase → Database → Backups: confirm a backup from today exists. Without one, stop.
2. **Upgrade the database.** Supabase → SQL Editor → paste `deploy/3-multi-tenant-upgrade.sql` → Run. It is one transaction: on any error nothing changes. It refuses to run twice.
3. **Verify.** Run `deploy/4-verify-multi-tenant.sql`. Every row must say PASS (21 checks).
4. **Set the two app passwords** (new `pitch_platform` role, and a fresh `pitch_app` one): `npm run setup:local` on your computer. It also writes `PLATFORM_DATABASE_URL` and offers to create the platform Super Admin at a hidden password prompt.
5. **Vercel:** add `PLATFORM_DATABASE_URL` (transaction pooler, user `pitch_platform.emtadepabamemdxmumyc`, port 6543) and update `DATABASE_URL` if you changed the `pitch_app` password. Then deploy the new code (push to `main`).
6. **Smoke test** (§7), plus: Super Admin signs in → `/platform` lists company **TAM – Tamada Media**; an existing employee signs in and sees their pitches exactly as before.

What the upgrade does to existing data: everything moves into company **TAM** (pitch codes stay `PT-2026-…`, new ones continue the same series), the old *Super Admin* role becomes **Company Admin** inside TAM (it does **not** become a platform Super Admin), TAM gets the Enterprise plan, the `tamadamedia.com` email domain, and an email exception for every existing non-`tamadamedia.com` account. Tested on a copy of a seeded 0005 database: row counts for users, pitches, events, audit, creators and notifications identical before and after; 21/21 verification checks passed; Drizzle recognises the migration as applied.

Rollback: restore the backup from step 1 and redeploy the previous code. There is no in-place downgrade.

## 1. Database passwords

1. **Supabase → Project Settings → Database → Reset database password.** Use a password manager; this is the `postgres` (migration) password.
2. **Set the `pitch_app` password** from your terminal, so it is encrypted before it leaves your machine and is not kept in the dashboard's SQL history:
   ```bash
   psql "postgresql://postgres.emtadepabamemdxmumyc@<SESSION-POOLER-HOST>:5432/postgres?sslmode=verify-full&sslrootcert=supabase-ca.crt"
   \password pitch_app
   ```
   Copy the pooler host from **Connect** (top bar) → *Session pooler*. Do not guess it.

## 2. TLS certificate

**Project Settings → Database → SSL Configuration → Download certificate.** Save it as `supabase-ca.crt` outside the repository folder (or anywhere git-ignored); its contents become `DATABASE_CA_CERT`. Optionally turn on **Enforce SSL on incoming connections** there.

The app verifies the server certificate and refuses to start in production without this variable. Do **not** add `sslmode` to `DATABASE_URL`.

## 3. Storage key

**Project Settings → API Keys → Secret keys → create** a key named `pitch-tracker-vercel`. It bypasses RLS: server-side only, never `NEXT_PUBLIC_`, never in the browser.

## 4. Vercel project

Import the GitHub repository → Framework: Next.js. **Settings → Environment Variables**, scope **Production** only (create separate values later for Preview/staging — never share production credentials with previews):

| Variable | Value |
|---|---|
| `APP_ENV` | `production` |
| `APP_ORIGIN` | `https://<your-production-domain>` (exact, no trailing slash) |
| `TRUST_PROXY` | `true` (Vercel appends the client IP) |
| `DATABASE_URL` | Connect → *Transaction pooler* string, with user **`pitch_app.emtadepabamemdxmumyc`**, port **6543**, and the `pitch_app` password |
| `PLATFORM_DATABASE_URL` | same host and port, user **`pitch_platform.emtadepabamemdxmumyc`**, its own password |
| `DATABASE_CA_CERT` | contents of the downloaded certificate |
| `SESSION_TOKEN_PEPPER` | `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"` |
| `MFA_ENCRYPTION_KEY` | same command, a different value |
| `CRON_SECRET` | same command, a different value |
| `SUPABASE_URL` | `https://emtadepabamemdxmumyc.supabase.co` |
| `SUPABASE_SECRET_KEY` | the key from step 3 |
| `STORAGE_BUCKET` | `pitch-files` |

Do **not** set `MIGRATION_DATABASE_URL`, `ALLOW_MEMORY_STORAGE` or `DEMO_USER_PASSWORD` in Vercel.

`Likely (not verified):` the transaction pooler accepts the custom role as `pitch_app.<ref>`. If sign-in to the database fails, use the *Session pooler* string (port 5432) with the same user as a test; tell whoever maintains the app which one worked.

## 5. Scheduled jobs

`vercel.json` schedules `/api/cron/run` once a day at 20:30 UTC (02:00 IST): email outbox, follow-up reminders, aging alerts, projection reconciliation, retention clean-up. Vercel Hobby allows only daily crons, so that is all that ships.

On Vercel Pro, add a second entry to process notification emails every 10 minutes:
```json
{ "path": "/api/cron/run", "schedule": "*/10 * * * *" }
```

## 6. Platform Super Admin

Easiest: answer **yes** at the end of `npm run setup:local`. Or later, from the project folder on your computer (reads `.env.local`):
```bash
npm run admin:create -- dash.tamad@gmail.com "Full Name"
```
The password is typed at a hidden prompt (16+ characters, checked against the password policy) and never appears in the terminal, history, logs or chat. Running it again for the same email resets the password and signs out existing sessions. On first sign-in the app forces authenticator-app (MFA) setup. The Super Admin works at `/platform` and cannot open any company's pitches, scripts or creators.

## 7. Smoke test after the first deploy

1. Response headers include `content-security-policy` and `strict-transport-security`.
2. Sign in as the platform Super Admin → MFA setup → `/platform` loads and lists TAM.
3. Sign in as a TAM Company Admin → **Users**: invite a test employee with a `tamadamedia.com` address; open the invitation link in a private window and choose a password.
4. As the Employee create a pitch and **upload a small PDF**, then download it. This is the first real test of Supabase Storage.
5. In Supabase **Storage → pitch-files**, confirm the object sits under a server-generated key, and that its public URL returns an error.
6. Trigger the cron once: `curl -H "Authorization: Bearer $CRON_SECRET" https://<domain>/api/cron/run?task=daily` → JSON, and without the header → 401.
7. Archive the test user and pitch.

## Future migrations

New files in `drizzle/` are applied with the migration role from a trusted machine or a CI job holding `MIGRATION_DATABASE_URL`:
```bash
MIGRATION_DATABASE_URL='<session pooler or direct, user postgres.<ref>>' DATABASE_CA_CERT="$(cat supabase-ca.crt)" APP_ENV=production npm run db:migrate
```
Then re-run the Supabase security advisor. Every new table needs the grant + RLS + policy + API-role revoke block (see `drizzle/0003_uploads.sql`).

## Backups

`Unknown:` depends on your Supabase plan. Check **Database → Backups**; point-in-time recovery is a paid add-on. Before real data arrives, restore a backup into a separate project once and record that it worked.
