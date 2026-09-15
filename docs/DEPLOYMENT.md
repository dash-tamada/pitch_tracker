# Deployment — Supabase + Vercel

Production stack: **Supabase** (PostgreSQL 17 + private Storage, region ap-south-1 Mumbai) and **Vercel** (Next.js, region `bom1` Mumbai).

Supabase project: `pitch-tracker` · ref `pxbqaqnzgrstdaoubirr` · API URL `https://pxbqaqnzgrstdaoubirr.supabase.co`

> Secrets in this guide are created and pasted **only** into the Supabase dashboard, Vercel settings, or your own terminal. Never into chat, tickets, email or code.

## Status (15 Sep 2026)

| Step | State |
|---|---|
| Project created, healthy | Done |
| Migrations 0000–0005 applied; Drizzle journal rows recorded (so `npm run db:migrate` skips them) | Done — schema fingerprint identical to a locally migrated database (columns, constraints, indexes, triggers, enums, grants, policies) |
| Configuration seeded (38 permissions, 7 roles, 162 role permissions, 74 lookups, 6 rating categories, 10 platforms, 4 settings, workflow v1 with 19 stages / 60 transitions) | Done — row-level hash identical to local seed |
| Private bucket `pitch-files` | Done |
| Security advisor | 0 findings |
| Performance advisor | INFO only: unused indexes (expected on an empty database) and FKs on audit columns such as `created_by_id` without indexes (low impact; revisit with real traffic) |
| No demo data in production | Confirmed |
| Steps 1–7 below | **Yours to do** |

## 1. Database passwords

1. **Supabase → Project Settings → Database → Reset database password.** Use a password manager; this is the `postgres` (migration) password.
2. **Set the `pitch_app` password** from your terminal, so it is encrypted before it leaves your machine and is not kept in the dashboard's SQL history:
   ```bash
   psql "postgresql://postgres.pxbqaqnzgrstdaoubirr@<SESSION-POOLER-HOST>:5432/postgres?sslmode=verify-full&sslrootcert=supabase-ca.crt"
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
| `DATABASE_URL` | Connect → *Transaction pooler* string, with user **`pitch_app.pxbqaqnzgrstdaoubirr`**, port **6543**, and the `pitch_app` password |
| `DATABASE_CA_CERT` | contents of the downloaded certificate |
| `SESSION_TOKEN_PEPPER` | `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"` |
| `MFA_ENCRYPTION_KEY` | same command, a different value |
| `CRON_SECRET` | same command, a different value |
| `SUPABASE_URL` | `https://pxbqaqnzgrstdaoubirr.supabase.co` |
| `SUPABASE_SECRET_KEY` | the key from step 3 |
| `STORAGE_BUCKET` | `pitch-files` |

Do **not** set `MIGRATION_DATABASE_URL`, `ALLOW_MEMORY_STORAGE`, `BOOTSTRAP_ADMIN_PASSWORD` or `DEMO_USER_PASSWORD` in Vercel.

`Likely (not verified):` the transaction pooler accepts the custom role as `pitch_app.<ref>`. If sign-in to the database fails, use the *Session pooler* string (port 5432) with the same user as a test; tell whoever maintains the app which one worked.

## 5. Scheduled jobs

`vercel.json` schedules `/api/cron/run` once a day at 20:30 UTC (02:00 IST): email outbox, follow-up reminders, aging alerts, projection reconciliation, retention clean-up. Vercel Hobby allows only daily crons, so that is all that ships.

On Vercel Pro, add a second entry to process notification emails every 10 minutes:
```json
{ "path": "/api/cron/run", "schedule": "*/10 * * * *" }
```

## 6. First Super Admin

From your own machine, after `npm ci`, with the variables set only for this shell:

**macOS/Linux**
```bash
export DATABASE_URL='<transaction pooler string for pitch_app>'
export DATABASE_CA_CERT="$(cat supabase-ca.crt)"
export APP_ENV=production
read -rs BOOTSTRAP_ADMIN_PASSWORD && export BOOTSTRAP_ADMIN_PASSWORD
npm run admin:create -- durgaji@tamadamedia.com "Durgaji Yedida"
unset DATABASE_URL DATABASE_CA_CERT BOOTSTRAP_ADMIN_PASSWORD
```

**Windows PowerShell**
```powershell
$env:DATABASE_URL = Read-Host "pitch_app transaction pooler URL"
$env:DATABASE_CA_CERT = Get-Content -Raw .\supabase-ca.crt
$env:APP_ENV = "production"
$env:BOOTSTRAP_ADMIN_PASSWORD = Read-Host "Admin password (min 12 chars)"
npm run admin:create -- durgaji@tamadamedia.com "Durgaji Yedida"
Remove-Item env:DATABASE_URL, env:DATABASE_CA_CERT, env:BOOTSTRAP_ADMIN_PASSWORD
```
Clear the PowerShell history line afterwards if the URL was typed inline. On first sign-in the app forces authenticator-app (MFA) setup.

## 7. Smoke test after the first deploy

1. Response headers include `content-security-policy` and `strict-transport-security`.
2. Sign in as Super Admin → MFA setup → dashboard loads.
3. **Settings → Users**: create a test Employee; open the set-password link in a private window.
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
