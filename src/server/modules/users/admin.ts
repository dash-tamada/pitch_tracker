/**
 * User & role administration. Guard rails:
 *  - nobody changes their own roles, status or clearance
 *  - only a Company Admin can grant/revoke Company Admin or modify another Company Admin
 *  - the last active Company Admin cannot be removed or disabled
 *  - any change to roles, status or clearance revokes that user's sessions and is audited
 * New users are INVITED: they receive a one-time invitation link (hashed token, 72 h) and choose their own password.
 * Admins never see, set or receive employee passwords. Email policy and plan limits are enforced here, server-side.
 */
import { and, asc, eq, gt, inArray, isNull, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { getPlatformDb, type Db, type DbOrTx } from "@/server/db/client";
import { jobOutbox, passwordResetTokens, permissions, pitches, rolePermissions, roles, sessions, userRoles, users } from "@/server/db/schema";
import { AppError, notFound } from "@/server/lib/errors";
import { parseInput } from "@/server/lib/validation";
import { requirePermission, type Actor } from "@/server/modules/authz/policy";
import { writeAudit, type RequestContext } from "@/server/modules/audit/service";
import { hashPassword, passwordPolicyErrors } from "@/server/modules/auth/password";
import { hashToken, newToken } from "@/server/modules/auth/tokens";
import { revokeAllSessions } from "@/server/modules/auth/service";
import { assertEmailAllowed, issueInvitation } from "@/server/modules/tenancy/invitations";
import { assertCanAddUser } from "@/server/modules/tenancy/limits";
import { reassignOwnedPitches } from "@/server/modules/workflow/engine";

const ROLE_KEY = z.string().regex(/^[A-Z_]{3,50}$/);
const isCompanyAdmin = (actor: Actor) => actor.roles.has("COMPANY_ADMIN");

export async function listUsers(db: Db, actor: Actor) {
  requirePermission(actor, "user.manage");
  const rows = await db.select({ id: users.id, email: users.email, fullName: users.fullName, status: users.status, clearance: users.clearance,
    department: users.department, designation: users.designation, employeeCode: users.employeeCode, mobileE164: users.mobileE164,
    mfaEnabled: users.mfaEnabled, lastLoginAt: users.lastLoginAt, lockedUntil: users.lockedUntil, createdAt: users.createdAt,
    roles: sql<string[]>`coalesce((SELECT array_agg(r.key ORDER BY r.key) FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = "users"."id"), '{}')` })
    .from(users).where(isNull(users.archivedAt)).orderBy(asc(users.fullName));
  return rows;
}

const optionalText = (max: number) => z.string().trim().max(max).optional();

export const createUserSchema = z.object({
  email: z.email().max(254), fullName: z.string().trim().min(2).max(120), roleKeys: z.array(ROLE_KEY).min(1).max(5),
  clearance: z.enum(["STANDARD", "CONFIDENTIAL", "RESTRICTED"]).default("CONFIDENTIAL"),
  firstName: optionalText(60), lastName: optionalText(60),
  mobileE164: z.string().regex(/^\+[1-9][0-9]{7,14}$/).optional(),
  department: optionalText(120), designation: optionalText(120), employeeCode: optionalText(40),
  joiningDate: z.iso.date().optional(),
  // Optional: set this employee's password directly instead of sending an invitation link. Off by default —
  // see the module docstring. Requesting admin explicitly asked for this despite the trade-off (2026-09-17):
  // any Admin/Company Admin can then set and see an employee's password, not just this one bootstrap case.
  tempPassword: z.string().min(1).max(128).optional(),
}).strict();

async function assertRoleChangeAllowed(db: DbOrTx, actor: Actor, targetUserId: string | null, roleKeys: string[]) {
  if (roleKeys.length) {
    const found = await db.select({ key: roles.key }).from(roles).where(inArray(roles.key, roleKeys));
    if (found.length !== new Set(roleKeys).size) throw new AppError("VALIDATION", "Unknown role.", { roleKeys: "Invalid" });
  }
  if (roleKeys.includes("COMPANY_ADMIN") && !isCompanyAdmin(actor)) throw new AppError("FORBIDDEN", "Only a Company Admin can grant Company Admin.");
  if (targetUserId) {
    if (targetUserId === actor.userId) throw new AppError("FORBIDDEN", "You cannot change your own access.");
    const current = await db.select({ key: roles.key }).from(userRoles).innerJoin(roles, eq(roles.id, userRoles.roleId)).where(eq(userRoles.userId, targetUserId));
    if (current.some((r) => r.key === "COMPANY_ADMIN") && !isCompanyAdmin(actor)) throw new AppError("FORBIDDEN", "Only a Company Admin can change a Company Admin.");
  }
}

async function activeCompanyAdminCount(db: DbOrTx, excludeUserId?: string) {
  const [r] = await db.select({ n: sql<number>`count(DISTINCT ${users.id})::int` }).from(users)
    .innerJoin(userRoles, eq(userRoles.userId, users.id)).innerJoin(roles, eq(roles.id, userRoles.roleId))
    .where(and(eq(roles.key, "COMPANY_ADMIN"), eq(users.status, "ACTIVE"), isNull(users.archivedAt), ...(excludeUserId ? [ne(users.id, excludeUserId)] : [])));
  return r?.n ?? 0;
}

async function issueSetPasswordToken(db: DbOrTx, userId: string, ttlMs: number) {
  const token = newToken();
  await db.insert(passwordResetTokens).values({ userId, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + ttlMs) });
  return token;
}

/**
 * Invites an employee. Returns the invitation link once so the admin can hand it over if email is not configured.
 * If tempPassword is given instead, the employee is created ACTIVE with that password and no invitation link is
 * issued — password_hash still can never be written on this (tenant/pitch_app) connection, DB trigger enforced, so
 * it is hashed here and written in a second step through the identity connection (pitch_platform), same two-step
 * pattern as the platform's createCompanyAdminWithPassword.
 */
export async function createUser(db: Db, actor: Actor, raw: unknown, ctx: RequestContext = {}) {
  requirePermission(actor, "user.manage");
  const input = parseInput(createUserSchema, raw);
  if (input.clearance === "RESTRICTED" && !isCompanyAdmin(actor)) throw new AppError("FORBIDDEN", "Only a Company Admin can grant RESTRICTED clearance.");
  const email = input.email.trim().toLowerCase();
  if (input.tempPassword) {
    const errors = passwordPolicyErrors(input.tempPassword, { email, fullName: input.fullName });
    if (errors.length) throw new AppError("VALIDATION", errors.join(" "), { tempPassword: errors[0]! });
  }
  try {
    const { userId, invitePath } = await db.transaction(async (tx) => {
      await assertRoleChangeAllowed(tx, actor, null, input.roleKeys);
      await assertEmailAllowed(tx, email);
      await assertCanAddUser(tx);
      const [exists] = await tx.select({ id: users.id }).from(users).where(eq(users.email, email));
      if (exists) throw new AppError("CONFLICT", "A user with this email already exists in your company.");
      const [u] = await tx.insert(users).values({ email, fullName: input.fullName, clearance: input.clearance, status: input.tempPassword ? "ACTIVE" : "INVITED",
        firstName: input.firstName ?? null, lastName: input.lastName ?? null, mobileE164: input.mobileE164 ?? null, department: input.department ?? null,
        designation: input.designation ?? null, employeeCode: input.employeeCode ?? null, joiningDate: input.joiningDate ?? null })
        .returning({ id: users.id });
      const rs = await tx.select({ id: roles.id }).from(roles).where(inArray(roles.key, input.roleKeys));
      await tx.insert(userRoles).values(rs.map((r) => ({ userId: u!.id, roleId: r.id, grantedById: actor.userId })));
      if (input.tempPassword) {
        await writeAudit(tx, { actorId: actor.userId, action: "user.invited", resourceType: "user", resourceId: u!.id,
          after: { fullName: input.fullName, roles: input.roleKeys, clearance: input.clearance, department: input.department, designation: input.designation, passwordSetDirectly: true } }, ctx);
        return { userId: u!.id, invitePath: null as string | null };
      }
      const token = await issueInvitation(tx, u!.id, actor.userId);
      await writeAudit(tx, { actorId: actor.userId, action: "user.invited", resourceType: "user", resourceId: u!.id,
        after: { fullName: input.fullName, roles: input.roleKeys, clearance: input.clearance, department: input.department, designation: input.designation } }, ctx);
      return { userId: u!.id, invitePath: `/accept-invite#${token}` as string | null };
    });
    if (input.tempPassword) {
      const passwordHash = await hashPassword(input.tempPassword);
      // passwordChangedAt stays null: forces a password change on first sign-in (enforced server-side), same as createCompanyAdminWithPassword.
      await getPlatformDb().update(users).set({ passwordHash, passwordChangedAt: null }).where(eq(users.id, userId));
    }
    return { id: userId, invitePath };
  } catch (e) {
    // Email addresses are unique across the whole platform. An address registered with another company is not visible
    // here (row-level security), so the insert hits the unique index: answer generically, without naming the other company.
    const code = (e as { code?: string; cause?: { code?: string } }).cause?.code ?? (e as { code?: string }).code;
    if (code === "23505") throw new AppError("CONFLICT", "This email address cannot be invited. It may already be registered.", { email: "Unavailable" });
    throw e;
  }
}

/** Issues a fresh invitation for a user who has not accepted yet (the previous link stops working). */
export async function resendInvitation(db: Db, actor: Actor, userId: string, ctx: RequestContext = {}) {
  requirePermission(actor, "user.manage");
  return db.transaction(async (tx) => {
    const [u] = await tx.select({ id: users.id, status: users.status }).from(users).where(and(eq(users.id, userId), isNull(users.archivedAt)));
    if (!u) throw notFound("User");
    if (u.status !== "INVITED") throw new AppError("CONFLICT", "This person has already accepted their invitation.");
    await assertRoleChangeAllowed(tx, actor, userId, []);
    const token = await issueInvitation(tx, userId, actor.userId);
    await writeAudit(tx, { actorId: actor.userId, action: "user.invitation_resent", resourceType: "user", resourceId: userId }, ctx);
    return { invitePath: `/accept-invite#${token}` };
  });
}

export const updateUserSchema = z.object({
  fullName: z.string().trim().min(2).max(120).optional(),
  roleKeys: z.array(ROLE_KEY).min(1).max(5).optional(),
  status: z.enum(["ACTIVE", "DISABLED"]).optional(),
  clearance: z.enum(["STANDARD", "CONFIDENTIAL", "RESTRICTED"]).optional(),
  unlock: z.boolean().optional(),
  department: z.string().trim().max(120).nullable().optional(),
  designation: z.string().trim().max(120).nullable().optional(),
  employeeCode: z.string().trim().max(40).nullable().optional(),
  mobileE164: z.string().regex(/^\+[1-9][0-9]{7,14}$/).nullable().optional(),
  /** Required when disabling someone who still owns open pitches: they move to this active colleague. */
  reassignToUserId: z.uuid().optional(),
}).strict();

export async function updateUser(db: Db, actor: Actor, userId: string, raw: unknown, ctx: RequestContext = {}) {
  requirePermission(actor, "user.manage");
  const input = parseInput(updateUserSchema, raw);
  return db.transaction(async (tx) => {
    const [before] = await tx.select({ id: users.id, status: users.status, clearance: users.clearance, fullName: users.fullName })
      .from(users).where(and(eq(users.id, userId), isNull(users.archivedAt))).for("update");
    if (!before) throw notFound("User");
    const beforeRoles = (await tx.select({ key: roles.key }).from(userRoles).innerJoin(roles, eq(roles.id, userRoles.roleId)).where(eq(userRoles.userId, userId))).map((r) => r.key).sort();
    const accessChange = input.roleKeys !== undefined || input.status !== undefined || input.clearance !== undefined;
    if (accessChange || input.unlock) {
      if (userId === actor.userId) throw new AppError("FORBIDDEN", "You cannot change your own access.");
      if (beforeRoles.includes("COMPANY_ADMIN") && !isCompanyAdmin(actor)) throw new AppError("FORBIDDEN", "Only a Company Admin can change a Company Admin.");
    }
    if (input.clearance === "RESTRICTED" && !isCompanyAdmin(actor)) throw new AppError("FORBIDDEN", "Only a Company Admin can grant RESTRICTED clearance.");
    if (input.roleKeys) await assertRoleChangeAllowed(tx, actor, userId, input.roleKeys);
    const losesCompanyAdmin = beforeRoles.includes("COMPANY_ADMIN") && ((input.roleKeys && !input.roleKeys.includes("COMPANY_ADMIN")) || input.status === "DISABLED");
    if (losesCompanyAdmin && (await activeCompanyAdminCount(tx, userId)) === 0) throw new AppError("CONFLICT", "The last active Company Admin cannot be removed.");

    if (input.status === "ACTIVE" && before.status === "INVITED") throw new AppError("CONFLICT", "Invited people become active when they accept their invitation.");
    let reassigned = 0;
    if (input.status === "DISABLED") {
      const [owned] = await tx.select({ n: sql<number>`count(*)::int` }).from(pitches).where(and(eq(pitches.currentOwnerId, userId), isNull(pitches.archivedAt)));
      if ((owned?.n ?? 0) > 0) {
        if (!input.reassignToUserId) throw new AppError("CONFLICT", `This person owns ${owned!.n} open pitch(es). Choose who takes them over before disabling.`, { reassignToUserId: "Required" });
        reassigned = (await reassignOwnedPitches(tx, actor, userId, input.reassignToUserId, ctx)).reassigned;
      }
    }

    const patch: Partial<typeof users.$inferInsert> = {};
    if (input.fullName) patch.fullName = input.fullName;
    if (input.status) { patch.status = input.status; patch.disabledAt = input.status === "DISABLED" ? new Date() : null; }
    if (input.department !== undefined) patch.department = input.department;
    if (input.designation !== undefined) patch.designation = input.designation;
    if (input.employeeCode !== undefined) patch.employeeCode = input.employeeCode;
    if (input.mobileE164 !== undefined) patch.mobileE164 = input.mobileE164;
    if (input.clearance) patch.clearance = input.clearance;
    if (input.unlock) { patch.lockedUntil = null; patch.failedLoginCount = 0; }
    if (Object.keys(patch).length) await tx.update(users).set(patch).where(eq(users.id, userId));
    if (input.roleKeys) {
      await tx.delete(userRoles).where(eq(userRoles.userId, userId));
      const rs = await tx.select({ id: roles.id }).from(roles).where(inArray(roles.key, input.roleKeys));
      await tx.insert(userRoles).values(rs.map((r) => ({ userId, roleId: r.id, grantedById: actor.userId })));
    }
    if (accessChange) await revokeAllSessions(tx, userId);
    await writeAudit(tx, { actorId: actor.userId, action: input.roleKeys || input.clearance ? "permission.changed" : "user.updated", resourceType: "user", resourceId: userId,
      before: { roles: beforeRoles, status: before.status, clearance: before.clearance, fullName: before.fullName },
      after: { roles: input.roleKeys?.slice().sort(), status: input.status, clearance: input.clearance, fullName: input.fullName, unlocked: input.unlock,
        reassignedPitches: reassigned || undefined, reassignedTo: reassigned ? input.reassignToUserId : undefined } }, ctx);
    return { id: userId, reassignedPitches: reassigned };
  });
}

/** Admin-issued reset link (fallback when email delivery is not configured). Revokes existing sessions. */
export async function issuePasswordResetLink(db: Db, actor: Actor, userId: string, ctx: RequestContext = {}) {
  requirePermission(actor, "user.manage");
  if (userId === actor.userId) throw new AppError("FORBIDDEN", "Use the normal reset flow for your own account.");
  return db.transaction(async (tx) => {
    const current = await tx.select({ key: roles.key }).from(userRoles).innerJoin(roles, eq(roles.id, userRoles.roleId)).where(eq(userRoles.userId, userId));
    if (current.some((r) => r.key === "COMPANY_ADMIN") && !isCompanyAdmin(actor)) throw new AppError("FORBIDDEN", "Only a Company Admin can reset a Company Admin.");
    const [u] = await tx.select({ id: users.id }).from(users).where(eq(users.id, userId));
    if (!u) throw notFound("User");
    await tx.update(passwordResetTokens).set({ usedAt: new Date() }).where(and(eq(passwordResetTokens.userId, userId), isNull(passwordResetTokens.usedAt)));
    const token = await issueSetPasswordToken(tx, userId, 24 * 3600_000);
    await writeAudit(tx, { actorId: actor.userId, action: "user.password_reset_link_issued", resourceType: "user", resourceId: userId }, ctx);
    return { setPasswordPath: `/set-password#${token}` };
  });
}

/**
 * Self-service, identity connection (getPlatformDb()). Always answers the same way whether or not the email exists.
 * Token goes to the email outbox only. Platform accounts are excluded: they are recovered by an operator, not by email.
 */
export async function requestPasswordReset(db: Db, raw: unknown, ctx: RequestContext = {}) {
  const { email } = parseInput(z.object({ email: z.email().max(254) }).strict(), raw);
  const [u] = await db.select({ id: users.id, status: users.status, companyId: users.companyId }).from(users).where(and(eq(users.email, email.toLowerCase()), isNull(users.archivedAt)));
  if (u && u.status === "ACTIVE" && u.companyId) {
    const [recent] = await db.select({ n: sql<number>`count(*)::int` }).from(passwordResetTokens)
      .where(and(eq(passwordResetTokens.userId, u.id), gt(passwordResetTokens.createdAt, new Date(Date.now() - 3600_000))));
    if ((recent?.n ?? 0) < 3) {
      await db.transaction(async (tx) => {
        const token = await issueSetPasswordToken(tx, u.id, 30 * 60_000);
        // The raw token lives only in the outbox payload until the worker emails it, then the payload is cleared.
        await tx.insert(jobOutbox).values({ companyId: u.companyId!, type: "EMAIL_PASSWORD_RESET", payload: { userId: u.id, token } });
        await writeAudit(tx, { companyId: u.companyId, actorId: u.id, action: "auth.password_reset_requested", resourceType: "user", resourceId: u.id }, ctx);
      });
    }
  }
  return { ok: true };
}

export async function completePasswordReset(db: Db, raw: unknown, ctx: RequestContext = {}) {
  const { token, password } = parseInput(z.object({ token: z.string().min(20).max(128), password: z.string().min(1).max(128) }).strict(), raw);
  return db.transaction(async (tx) => {
    const [t] = await tx.select().from(passwordResetTokens).where(eq(passwordResetTokens.tokenHash, hashToken(token))).for("update");
    if (!t || t.usedAt || t.expiresAt <= new Date()) throw new AppError("VALIDATION", "This link is invalid or has expired.");
    const [u] = await tx.select({ email: users.email, fullName: users.fullName, status: users.status, companyId: users.companyId }).from(users).where(eq(users.id, t.userId));
    if (!u || u.status !== "ACTIVE") throw new AppError("VALIDATION", "This link is invalid or has expired.");
    const errors = passwordPolicyErrors(password, { email: u.email, fullName: u.fullName });
    if (errors.length) throw new AppError("VALIDATION", errors.join(" "), { password: errors[0]! });
    await tx.update(passwordResetTokens).set({ usedAt: new Date() }).where(eq(passwordResetTokens.id, t.id));
    await tx.update(users).set({ passwordHash: await hashPassword(password), passwordChangedAt: new Date(), failedLoginCount: 0, lockedUntil: null }).where(eq(users.id, t.userId));
    await tx.update(sessions).set({ revokedAt: new Date() }).where(and(eq(sessions.userId, t.userId), isNull(sessions.revokedAt)));
    await writeAudit(tx, { companyId: u.companyId, actorId: t.userId, action: "auth.password_changed", resourceType: "user", resourceId: t.userId }, ctx);
    return { ok: true };
  });
}

/* ───────────── Roles & permissions ───────────── */

export async function listRolesWithPermissions(db: Db, actor: Actor) {
  requirePermission(actor, "role.manage");
  const rs = await db.select().from(roles).orderBy(asc(roles.key));
  const rp = await db.select().from(rolePermissions);
  const ps = await db.select().from(permissions).where(eq(permissions.scope, "COMPANY")).orderBy(asc(permissions.key));
  return { roles: rs.map((r) => ({ ...r, permissions: rp.filter((x) => x.roleId === r.id).map((x) => x.permissionKey) })), permissions: ps };
}

export async function setRolePermissions(db: Db, actor: Actor, roleKey: string, raw: unknown, ctx: RequestContext = {}) {
  requirePermission(actor, "role.manage");
  const { permissionKeys } = parseInput(z.object({ permissionKeys: z.array(z.string().max(60)).max(100) }).strict(), raw);
  if (roleKey === "COMPANY_ADMIN") throw new AppError("FORBIDDEN", "Company Admin always has every permission.");
  if (actor.roles.has(roleKey)) throw new AppError("FORBIDDEN", "You cannot change the permissions of a role you hold.");
  // Only a Company Admin may put administration permissions on a role (prevents an Admin creating a more powerful role).
  const adminPerms = ["user.manage", "role.manage", "workflow.manage", "config.manage", "audit.view", "data.export", "company.manage"];
  return db.transaction(async (tx) => {
    const [role] = await tx.select().from(roles).where(eq(roles.key, roleKey));
    if (!role) throw notFound("Role");
    const valid = await tx.select({ key: permissions.key }).from(permissions)
      .where(and(eq(permissions.scope, "COMPANY"), inArray(permissions.key, permissionKeys.length ? permissionKeys : ["-"])));
    if (valid.length !== new Set(permissionKeys).size) throw new AppError("VALIDATION", "Unknown permission.", { permissionKeys: "Invalid" });
    const before = (await tx.select({ k: rolePermissions.permissionKey }).from(rolePermissions).where(eq(rolePermissions.roleId, role.id))).map((x) => x.k).sort();
    const added = permissionKeys.filter((k) => !before.includes(k));
    if (!isCompanyAdmin(actor) && added.some((k) => adminPerms.includes(k))) throw new AppError("FORBIDDEN", "Only a Company Admin can grant administration permissions.");
    await tx.delete(rolePermissions).where(eq(rolePermissions.roleId, role.id));
    if (permissionKeys.length) await tx.insert(rolePermissions).values([...new Set(permissionKeys)].map((k) => ({ roleId: role.id, permissionKey: k })));
    // Everyone holding the role must re-authenticate so new permissions apply immediately.
    const holders = await tx.select({ userId: userRoles.userId }).from(userRoles).where(eq(userRoles.roleId, role.id));
    if (holders.length) await tx.update(sessions).set({ revokedAt: new Date() }).where(and(inArray(sessions.userId, holders.map((h) => h.userId)), isNull(sessions.revokedAt)));
    await writeAudit(tx, { actorId: actor.userId, action: "permission.changed", resourceType: "role", resourceId: role.id,
      before: { role: roleKey, permissions: before }, after: { role: roleKey, permissions: [...new Set(permissionKeys)].sort() } }, ctx);
    return { role: roleKey };
  });
}
