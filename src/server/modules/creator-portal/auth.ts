/**
 * Creator portal identity: register (via a company's one-time-generated link token), login, session
 * resolution and logout. Runs on the pitch_creator database role (see CreatorPool in db/client.ts) —
 * structurally separate from staff sign-in (auth/service.ts, pitch_platform). A creator can never
 * authenticate as staff, and staff can never read a creator's password hash (creators_company_insert_guard
 * trigger + no SELECT/UPDATE grant on those columns for pitch_app — drizzle/0007_creator_portal.sql).
 */
import { randomUUID } from "node:crypto";
import { and, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { creatorDb, getCreatorAnonDb } from "@/server/db/client";
import type { Db } from "@/server/db/client";
import { creators, creatorSessions } from "@/server/db/schema";
import { AppError } from "@/server/lib/errors";
import { normalizeEmail, normalizeMobile, normalizeName } from "@/server/lib/pii";
import { parseInput } from "@/server/lib/validation";
import { CREATOR_TYPES } from "@/server/modules/creators/service";
import { getDummyHash, hashPassword, passwordPolicyErrors, verifyPassword } from "@/server/modules/auth/password";
import { hashToken, newToken } from "@/server/modules/auth/tokens";
import type { RequestContext } from "@/server/modules/audit/service";

// A portal is used occasionally (submit, then check back weeks later) rather than continuously like the
// staff app — a 30-minute idle timeout would sign creators out mid-upload. Deliberately longer than
// auth/service.ts's staff session (12h / 30min): this is a separate, lower-privilege identity, not a
// staff account, so the usual "short session for an internal tool" trade-off does not apply the same way.
export const CREATOR_SESSION_ABSOLUTE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
export const CREATOR_SESSION_IDLE_MS = 7 * 24 * 60 * 60 * 1000;      // 7 days
const LOCKOUT_THRESHOLD = 5;
const LOCKOUT_MS = 15 * 60 * 1000;

const INVALID = () => new AppError("INVALID_CREDENTIALS", "Email or password is incorrect.");
const BAD_LINK = () => new AppError("NOT_FOUND", "This registration link is not valid or has been disabled.");
function pgCode(e: unknown): string | undefined {
  return (e as { cause?: { code?: string } })?.cause?.code ?? (e as { code?: string })?.code;
}
// creators has two separate unique indexes (email, mobile) — a 23505 on the insert could be either one,
// so the Postgres-reported constraint name (not a guess) decides which field the error points at.
function pgConstraint(e: unknown): string | undefined {
  return (e as { cause?: { constraint?: string } })?.cause?.constraint ?? (e as { constraint?: string })?.constraint;
}
// db.execute(sql`...`) returns raw driver rows: timestamptz columns come back as ISO strings, not the Date
// objects drizzle's query builder (.select()) would give — a string compares to a Date with `>`/`<` by first
// coercing the Date to a number and the string to NaN via ToNumber, so the comparison is silently always
// false rather than throwing. Every timestamp read off a raw execute() result is converted through this
// before it is compared, so a lockout/expiry check can never be quietly no-op the way one first was here.
function toDate(v: unknown): Date | null {
  return v == null ? null : v instanceof Date ? v : new Date(v as string);
}

/** Shared by every creator-portal module (auth/pitch/documents) — one best-effort audit call, one place. */
export async function auditPortalAction(db: Db, action: string, resourceType: string, resourceId: string | null, after?: unknown) {
  // Best-effort (see creator_portal_audit in drizzle/0007_creator_portal.sql) — never lets a logging
  // failure surface to the caller, whose real action has already been committed by this point.
  await db.execute(sql`SELECT public.creator_portal_audit(${action}, ${resourceType}, ${resourceId}, ${after ? JSON.stringify(after) : null}::jsonb)`).catch(() => undefined);
}

/** Resolves a raw portal link token (from the URL) to a company id, or null if unknown/disabled/blocked. */
export async function resolvePortalCompany(rawToken: string): Promise<string | null> {
  if (!rawToken || rawToken.length > 128) return null;
  const db = getCreatorAnonDb();
  const result = await db.execute(sql`SELECT public.resolve_creator_portal_company(${hashToken(rawToken)}::bytea) AS company_id`);
  const row = result.rows[0] as { company_id: string | null } | undefined;
  return row?.company_id ?? null;
}

export const registerSchema = z.object({
  token: z.string().min(1).max(128),
  creatorType: z.enum(CREATOR_TYPES),
  fullName: z.string().trim().min(2).max(120),
  mobile: z.string().trim().max(20).optional().or(z.literal("").transform(() => undefined)),
  email: z.email().max(254),
  password: z.string().min(1).max(128),
}).strict();

export interface CreatorRegisterResult { creatorId: string; companyId: string; token: string; expiresAt: Date }

export async function registerCreator(raw: unknown, ctx: RequestContext = {}, now = new Date()): Promise<CreatorRegisterResult> {
  const input = parseInput(registerSchema, raw);
  const companyId = await resolvePortalCompany(input.token);
  if (!companyId) throw BAD_LINK();

  const email = normalizeEmail(input.email);
  const mobileE164 = input.mobile ? normalizeMobile(input.mobile) : null;
  if (input.mobile && !mobileE164) throw new AppError("VALIDATION", "Mobile number is not valid.", { mobile: "Invalid" });
  const errors = passwordPolicyErrors(input.password, { email });
  if (errors.length) throw new AppError("VALIDATION", errors.join(" "), { password: errors[0]! });

  // Registration runs with a company context but no creator id yet (creator_register RLS policy needs
  // only company_id — see §5 of the migration); every other statement below reconnects once the new
  // creator's own id is known, so nothing after this point runs on an unscoped connection.
  const regDb = creatorDb(companyId, null);
  // No pre-check SELECT for an existing email: creator_self_select limits pitch_creator to its OWN row
  // (id = app_creator_id()), which is not yet known here — by the same RLS a creator can never browse
  // for whether another email is taken, so the unique index (creators_company_email_uq) is the only place
  // a duplicate can be caught, and it is caught below by catching its violation on the insert itself.
  const passwordHash = await hashPassword(input.password);
  // Generated here, not read back with .returning(): at insert time app.creator_id is still unset (this
  // account does not exist yet), so creator_self_select's RLS check ("id = app_creator_id()") would refuse
  // to hand the just-inserted row back — Postgres reports that as "new row violates row-level security
  // policy", indistinguishable at a glance from a genuine WITH CHECK failure. Knowing the id up front avoids
  // the read-back entirely; every later statement reconnects scoped to this specific creatorId.
  const creatorId = randomUUID();
  try {
    // The registration form already collects everything the handoff calls "profile" (creator type, full
    // name, mobile) — there is no separate profile step, so profileCompletedAt is set right here. This is
    // what lets the portal go straight to "New Pitch" after registration instead of forever showing a
    // completion prompt: profile_completed_at would otherwise stay NULL forever (nothing else ever sets it).
    await regDb.insert(creators).values({
      id: creatorId, creatorType: input.creatorType, fullName: input.fullName, nameNormalized: normalizeName(input.fullName),
      mobileE164, emailNormalized: email, selfRegistered: true, passwordHash, passwordChangedAt: now, portalStatus: "ACTIVE",
      profileCompletedAt: now,
    });
  } catch (e) {
    if (pgCode(e) === "23505") {
      if (pgConstraint(e) === "creators_company_mobile_uq") {
        throw new AppError("CONFLICT", "This mobile number is already registered to another account.", { mobile: "Already registered" });
      }
      throw new AppError("CONFLICT", "An account with this email already exists. Try logging in instead.", { email: "Already registered" });
    }
    throw e;
  }

  const sessionDb = creatorDb(companyId, creatorId);
  const token = newToken();
  const expiresAt = new Date(now.getTime() + CREATOR_SESSION_ABSOLUTE_MS);
  await sessionDb.insert(creatorSessions).values({ creatorId, tokenHash: hashToken(token), expiresAt, ip: ctx.ip ?? null, userAgent: ctx.userAgent?.slice(0, 512) ?? null });
  await auditPortalAction(sessionDb, "creator_portal.registered", "creator", creatorId, { email });
  return { creatorId, companyId, token, expiresAt };
}

export const loginSchema = z.object({
  token: z.string().min(1).max(128),
  email: z.email().max(254),
  password: z.string().min(1).max(128),
}).strict();

export interface CreatorLoginResult { creatorId: string; companyId: string; token: string; expiresAt: Date; profileCompleted: boolean }

export async function loginCreator(raw: unknown, ctx: RequestContext = {}, now = new Date()): Promise<CreatorLoginResult> {
  const parsed = parseInput(loginSchema, raw);
  const companyId = await resolvePortalCompany(parsed.token);
  if (!companyId) throw BAD_LINK();
  const email = normalizeEmail(parsed.email);

  // creator_self_select cannot answer "does this email exist" (it only ever shows the caller's own row,
  // and the caller has no row-identity yet) — creator_portal_login_lookup is the narrow, SECURITY DEFINER
  // bootstrap for exactly this, scoped to the already-resolved company (see its own comment in the migration).
  const lookupDb = creatorDb(companyId, null);
  const found = await lookupDb.execute(sql`SELECT * FROM public.creator_portal_login_lookup(${email})`);
  const rawRow = found.rows[0] as {
    id: string; password_hash: string | null; self_registered: boolean; portal_status: "ACTIVE" | "DISABLED";
    locked_until: string | null; failed_login_count: number; archived_at: string | null; profile_completed_at: string | null;
  } | undefined;
  const creator = rawRow && { ...rawRow, locked_until: toDate(rawRow.locked_until), archived_at: toDate(rawRow.archived_at), profile_completed_at: toDate(rawRow.profile_completed_at) };

  if (!creator || !creator.password_hash || !creator.self_registered || creator.archived_at) {
    await verifyPassword(await getDummyHash(), parsed.password); // equalise timing whether or not the account exists
    throw INVALID();
  }

  // From here on the connection is scoped to this specific creator id (satisfies creator_self_update).
  const ownDb = creatorDb(companyId, creator.id);

  if (creator.portal_status !== "ACTIVE") {
    await auditPortalAction(ownDb, "creator_portal.login_blocked_disabled", "creator", creator.id);
    throw new AppError("ACCOUNT_LOCKED", "This account has been disabled. Contact the company that invited you.");
  }
  if (creator.locked_until && creator.locked_until > now) {
    await auditPortalAction(ownDb, "creator_portal.login_blocked_locked", "creator", creator.id);
    throw new AppError("ACCOUNT_LOCKED", "Too many failed attempts. Try again in 15 minutes.");
  }

  const ok = await verifyPassword(creator.password_hash, parsed.password);
  if (!ok) {
    const failures = creator.failed_login_count + 1;
    await ownDb.update(creators).set({
      failedLoginCount: failures,
      lockedUntil: failures >= LOCKOUT_THRESHOLD ? new Date(now.getTime() + LOCKOUT_MS) : creator.locked_until,
    }).where(eq(creators.id, creator.id));
    await auditPortalAction(ownDb, failures >= LOCKOUT_THRESHOLD ? "creator_portal.account_locked" : "creator_portal.login_failed", "creator", creator.id);
    throw INVALID();
  }

  const token = newToken();
  const expiresAt = new Date(now.getTime() + CREATOR_SESSION_ABSOLUTE_MS);
  await ownDb.update(creators).set({ failedLoginCount: 0, lockedUntil: null, lastLoginAt: now }).where(eq(creators.id, creator.id));
  await ownDb.insert(creatorSessions).values({ creatorId: creator.id, tokenHash: hashToken(token), expiresAt, ip: ctx.ip ?? null, userAgent: ctx.userAgent?.slice(0, 512) ?? null });
  await auditPortalAction(ownDb, "creator_portal.login", "creator", creator.id);
  return { creatorId: creator.id, companyId, token, expiresAt, profileCompleted: Boolean(creator.profile_completed_at) };
}

export interface CreatorSessionInfo { creatorId: string; companyId: string; sessionId: string; profileCompleted: boolean }

/**
 * Resolves a raw session cookie token to a creator. Needs the company id up front (from the portal URL,
 * same as login) because creator_sessions is looked up on a connection already scoped to that company —
 * pitch_creator has no cross-company read at all, by design, so an unscoped lookup is not possible here.
 */
export async function resolveCreatorSession(companyId: string, token: string | undefined, now = new Date()): Promise<CreatorSessionInfo | null> {
  if (!token || token.length > 128) return null;
  // No creator id yet — the token itself is how we find one (same bootstrap as login), so this starts on
  // creator_portal_resolve_session, the SECURITY DEFINER lookup, not a direct RLS-scoped SELECT.
  const db = creatorDb(companyId, null);
  const found = await db.execute(sql`SELECT * FROM public.creator_portal_resolve_session(${hashToken(token)}::bytea)`);
  const raw = found.rows[0] as {
    creator_id: string; session_id: string; expires_at: string; revoked_at: string | null; last_seen_at: string;
    portal_status: "ACTIVE" | "DISABLED"; archived_at: string | null; profile_completed_at: string | null;
  } | undefined;
  if (!raw) return null;
  const row = { ...raw, expires_at: toDate(raw.expires_at)!, revoked_at: toDate(raw.revoked_at), last_seen_at: toDate(raw.last_seen_at)!, archived_at: toDate(raw.archived_at), profile_completed_at: toDate(raw.profile_completed_at) };
  if (row.revoked_at || row.expires_at <= now || now.getTime() - row.last_seen_at.getTime() > CREATOR_SESSION_IDLE_MS) return null;
  if (row.archived_at || row.portal_status !== "ACTIVE") return null;

  const ownDb = creatorDb(companyId, row.creator_id);
  if (now.getTime() - row.last_seen_at.getTime() > 60_000) {
    await ownDb.update(creatorSessions).set({ lastSeenAt: now }).where(eq(creatorSessions.id, row.session_id));
  }
  return { creatorId: row.creator_id, companyId, sessionId: row.session_id, profileCompleted: Boolean(row.profile_completed_at) };
}

export async function logoutCreator(companyId: string, creatorId: string, token: string | undefined): Promise<void> {
  if (!token) return;
  const db = creatorDb(companyId, creatorId);
  await db.update(creatorSessions).set({ revokedAt: new Date() })
    .where(and(eq(creatorSessions.tokenHash, hashToken(token)), eq(creatorSessions.creatorId, creatorId), isNull(creatorSessions.revokedAt)));
}
