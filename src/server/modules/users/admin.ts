/**
 * User & role administration. Guard rails:
 *  - nobody changes their own roles, status or clearance
 *  - only a Super Admin can grant/revoke Super Admin or modify another Super Admin
 *  - the last active Super Admin cannot be removed or disabled
 *  - any change to roles, status or clearance revokes that user's sessions and is audited
 * New users receive a one-time set-password link (hashed token, 72 h), never a password chosen by an admin.
 */
import { and, asc, eq, gt, inArray, isNull, ne, sql } from "drizzle-orm";
import { z } from "zod";
import type { Db, DbOrTx } from "@/server/db/client";
import { passwordResetTokens, permissions, rolePermissions, roles, sessions, userRoles, users } from "@/server/db/schema";
import { AppError, notFound } from "@/server/lib/errors";
import { parseInput } from "@/server/lib/validation";
import { requirePermission, type Actor } from "@/server/modules/authz/policy";
import { writeAudit, type RequestContext } from "@/server/modules/audit/service";
import { hashPassword, passwordPolicyErrors } from "@/server/modules/auth/password";
import { hashToken, newToken } from "@/server/modules/auth/tokens";
import { revokeAllSessions } from "@/server/modules/auth/service";

const ROLE_KEY = z.string().regex(/^[A-Z_]{3,50}$/);
const isSuper = (actor: Actor) => actor.roles.has("SUPER_ADMIN");

export async function listUsers(db: Db, actor: Actor) {
  requirePermission(actor, "user.manage");
  const rows = await db.select({ id: users.id, email: users.email, fullName: users.fullName, status: users.status, clearance: users.clearance,
    mfaEnabled: users.mfaEnabled, lastLoginAt: users.lastLoginAt, lockedUntil: users.lockedUntil, createdAt: users.createdAt,
    roles: sql<string[]>`coalesce((SELECT array_agg(r.key ORDER BY r.key) FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = "users"."id"), '{}')` })
    .from(users).where(isNull(users.archivedAt)).orderBy(asc(users.fullName));
  return rows;
}

export const createUserSchema = z.object({
  email: z.email().max(254), fullName: z.string().trim().min(2).max(120), roleKeys: z.array(ROLE_KEY).min(1).max(5),
  clearance: z.enum(["STANDARD", "CONFIDENTIAL", "RESTRICTED"]).default("CONFIDENTIAL"),
}).strict();

async function assertRoleChangeAllowed(db: DbOrTx, actor: Actor, targetUserId: string | null, roleKeys: string[]) {
  const found = await db.select({ key: roles.key }).from(roles).where(inArray(roles.key, roleKeys));
  if (found.length !== new Set(roleKeys).size) throw new AppError("VALIDATION", "Unknown role.", { roleKeys: "Invalid" });
  if (roleKeys.includes("SUPER_ADMIN") && !isSuper(actor)) throw new AppError("FORBIDDEN", "Only a Super Admin can grant Super Admin.");
  if (targetUserId) {
    if (targetUserId === actor.userId) throw new AppError("FORBIDDEN", "You cannot change your own access.");
    const current = await db.select({ key: roles.key }).from(userRoles).innerJoin(roles, eq(roles.id, userRoles.roleId)).where(eq(userRoles.userId, targetUserId));
    if (current.some((r) => r.key === "SUPER_ADMIN") && !isSuper(actor)) throw new AppError("FORBIDDEN", "Only a Super Admin can change a Super Admin.");
  }
}

async function activeSuperAdminCount(db: DbOrTx, excludeUserId?: string) {
  const [r] = await db.select({ n: sql<number>`count(DISTINCT ${users.id})::int` }).from(users)
    .innerJoin(userRoles, eq(userRoles.userId, users.id)).innerJoin(roles, eq(roles.id, userRoles.roleId))
    .where(and(eq(roles.key, "SUPER_ADMIN"), eq(users.status, "ACTIVE"), isNull(users.archivedAt), ...(excludeUserId ? [ne(users.id, excludeUserId)] : [])));
  return r?.n ?? 0;
}

async function issueSetPasswordToken(db: DbOrTx, userId: string, ttlMs: number) {
  const token = newToken();
  await db.insert(passwordResetTokens).values({ userId, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + ttlMs) });
  return token;
}

export async function createUser(db: Db, actor: Actor, raw: unknown, ctx: RequestContext = {}) {
  requirePermission(actor, "user.manage");
  const input = parseInput(createUserSchema, raw);
  if (input.clearance === "RESTRICTED" && !isSuper(actor)) throw new AppError("FORBIDDEN", "Only a Super Admin can grant RESTRICTED clearance.");
  return db.transaction(async (tx) => {
    await assertRoleChangeAllowed(tx, actor, null, input.roleKeys);
    const email = input.email.trim().toLowerCase();
    const [exists] = await tx.select({ id: users.id }).from(users).where(eq(users.email, email));
    if (exists) throw new AppError("CONFLICT", "A user with this email already exists.");
    const [u] = await tx.insert(users).values({ email, fullName: input.fullName, clearance: input.clearance, status: "ACTIVE" }).returning({ id: users.id });
    const rs = await tx.select({ id: roles.id }).from(roles).where(inArray(roles.key, input.roleKeys));
    await tx.insert(userRoles).values(rs.map((r) => ({ userId: u!.id, roleId: r.id, grantedById: actor.userId })));
    const token = await issueSetPasswordToken(tx, u!.id, 72 * 3600_000);
    await writeAudit(tx, { actorId: actor.userId, action: "user.created", resourceType: "user", resourceId: u!.id, after: { fullName: input.fullName, roles: input.roleKeys, clearance: input.clearance } }, ctx);
    return { id: u!.id, setPasswordPath: `/set-password#${token}` };
  });
}

export const updateUserSchema = z.object({
  fullName: z.string().trim().min(2).max(120).optional(),
  roleKeys: z.array(ROLE_KEY).min(1).max(5).optional(),
  status: z.enum(["ACTIVE", "DISABLED"]).optional(),
  clearance: z.enum(["STANDARD", "CONFIDENTIAL", "RESTRICTED"]).optional(),
  unlock: z.boolean().optional(),
}).strict();

export async function updateUser(db: Db, actor: Actor, userId: string, raw: unknown, ctx: RequestContext = {}) {
  requirePermission(actor, "user.manage");
  const input = parseInput(updateUserSchema, raw);
  return db.transaction(async (tx) => {
    const [before] = await tx.select().from(users).where(and(eq(users.id, userId), isNull(users.archivedAt))).for("update");
    if (!before) throw notFound("User");
    const beforeRoles = (await tx.select({ key: roles.key }).from(userRoles).innerJoin(roles, eq(roles.id, userRoles.roleId)).where(eq(userRoles.userId, userId))).map((r) => r.key).sort();
    const accessChange = input.roleKeys !== undefined || input.status !== undefined || input.clearance !== undefined;
    if (accessChange || input.unlock) {
      if (userId === actor.userId) throw new AppError("FORBIDDEN", "You cannot change your own access.");
      if (beforeRoles.includes("SUPER_ADMIN") && !isSuper(actor)) throw new AppError("FORBIDDEN", "Only a Super Admin can change a Super Admin.");
    }
    if (input.clearance === "RESTRICTED" && !isSuper(actor)) throw new AppError("FORBIDDEN", "Only a Super Admin can grant RESTRICTED clearance.");
    if (input.roleKeys) await assertRoleChangeAllowed(tx, actor, userId, input.roleKeys);
    const losesSuper = beforeRoles.includes("SUPER_ADMIN") && ((input.roleKeys && !input.roleKeys.includes("SUPER_ADMIN")) || input.status === "DISABLED");
    if (losesSuper && (await activeSuperAdminCount(tx, userId)) === 0) throw new AppError("CONFLICT", "The last active Super Admin cannot be removed.");

    const patch: Partial<typeof users.$inferInsert> = {};
    if (input.fullName) patch.fullName = input.fullName;
    if (input.status) patch.status = input.status;
    if (input.clearance) patch.clearance = input.clearance;
    if (input.unlock) { patch.lockedUntil = null; patch.failedLoginCount = 0; }
    if (Object.keys(patch).length) await tx.update(users).set(patch).where(eq(users.id, userId));
    if (input.roleKeys) {
      await tx.delete(userRoles).where(eq(userRoles.userId, userId));
      const rs = await tx.select({ id: roles.id }).from(roles).where(inArray(roles.key, input.roleKeys));
      await tx.insert(userRoles).values(rs.map((r) => ({ userId, roleId: r.id, grantedById: actor.userId })));
    }
    if (accessChange) await revokeAllSessions(tx as unknown as Db, userId);
    await writeAudit(tx, { actorId: actor.userId, action: input.roleKeys || input.clearance ? "permission.changed" : "user.updated", resourceType: "user", resourceId: userId,
      before: { roles: beforeRoles, status: before.status, clearance: before.clearance, fullName: before.fullName },
      after: { roles: input.roleKeys?.slice().sort(), status: input.status, clearance: input.clearance, fullName: input.fullName, unlocked: input.unlock } }, ctx);
    return { id: userId };
  });
}

/** Admin-issued reset link (fallback when email delivery is not configured). Revokes existing sessions. */
export async function issuePasswordResetLink(db: Db, actor: Actor, userId: string, ctx: RequestContext = {}) {
  requirePermission(actor, "user.manage");
  if (userId === actor.userId) throw new AppError("FORBIDDEN", "Use the normal reset flow for your own account.");
  return db.transaction(async (tx) => {
    const current = await tx.select({ key: roles.key }).from(userRoles).innerJoin(roles, eq(roles.id, userRoles.roleId)).where(eq(userRoles.userId, userId));
    if (current.some((r) => r.key === "SUPER_ADMIN") && !isSuper(actor)) throw new AppError("FORBIDDEN", "Only a Super Admin can reset a Super Admin.");
    const [u] = await tx.select({ id: users.id }).from(users).where(eq(users.id, userId));
    if (!u) throw notFound("User");
    await tx.update(passwordResetTokens).set({ usedAt: new Date() }).where(and(eq(passwordResetTokens.userId, userId), isNull(passwordResetTokens.usedAt)));
    const token = await issueSetPasswordToken(tx, userId, 24 * 3600_000);
    await writeAudit(tx, { actorId: actor.userId, action: "user.password_reset_link_issued", resourceType: "user", resourceId: userId }, ctx);
    return { setPasswordPath: `/set-password#${token}` };
  });
}

/** Self-service: always answers the same way whether or not the email exists. Token goes to the email outbox only. */
export async function requestPasswordReset(db: Db, raw: unknown, ctx: RequestContext = {}) {
  const { email } = parseInput(z.object({ email: z.email().max(254) }).strict(), raw);
  const [u] = await db.select({ id: users.id, status: users.status }).from(users).where(and(eq(users.email, email.toLowerCase()), isNull(users.archivedAt)));
  if (u && u.status === "ACTIVE") {
    const [recent] = await db.select({ n: sql<number>`count(*)::int` }).from(passwordResetTokens)
      .where(and(eq(passwordResetTokens.userId, u.id), gt(passwordResetTokens.createdAt, new Date(Date.now() - 3600_000))));
    if ((recent?.n ?? 0) < 3) {
      await db.transaction(async (tx) => {
        const token = await issueSetPasswordToken(tx, u.id, 30 * 60_000);
        const { jobOutbox } = await import("@/server/db/schema");
        // The raw token lives only in the outbox payload until the worker emails it, then the payload is cleared.
        await tx.insert(jobOutbox).values({ type: "EMAIL_PASSWORD_RESET", payload: { userId: u.id, token } });
        await writeAudit(tx, { actorId: u.id, action: "auth.password_reset_requested", resourceType: "user", resourceId: u.id }, ctx);
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
    const [u] = await tx.select({ email: users.email, fullName: users.fullName, status: users.status }).from(users).where(eq(users.id, t.userId));
    if (!u || u.status !== "ACTIVE") throw new AppError("VALIDATION", "This link is invalid or has expired.");
    const errors = passwordPolicyErrors(password, { email: u.email, fullName: u.fullName });
    if (errors.length) throw new AppError("VALIDATION", errors.join(" "), { password: errors[0]! });
    await tx.update(passwordResetTokens).set({ usedAt: new Date() }).where(eq(passwordResetTokens.id, t.id));
    await tx.update(users).set({ passwordHash: await hashPassword(password), passwordChangedAt: new Date(), failedLoginCount: 0, lockedUntil: null }).where(eq(users.id, t.userId));
    await tx.update(sessions).set({ revokedAt: new Date() }).where(and(eq(sessions.userId, t.userId), isNull(sessions.revokedAt)));
    await writeAudit(tx, { actorId: t.userId, action: "auth.password_changed", resourceType: "user", resourceId: t.userId }, ctx);
    return { ok: true };
  });
}

/* ───────────── Roles & permissions ───────────── */

export async function listRolesWithPermissions(db: Db, actor: Actor) {
  requirePermission(actor, "role.manage");
  const rs = await db.select().from(roles).orderBy(asc(roles.key));
  const rp = await db.select().from(rolePermissions);
  const ps = await db.select().from(permissions).orderBy(asc(permissions.key));
  return { roles: rs.map((r) => ({ ...r, permissions: rp.filter((x) => x.roleId === r.id).map((x) => x.permissionKey) })), permissions: ps };
}

export async function setRolePermissions(db: Db, actor: Actor, roleKey: string, raw: unknown, ctx: RequestContext = {}) {
  requirePermission(actor, "role.manage");
  const { permissionKeys } = parseInput(z.object({ permissionKeys: z.array(z.string().max(60)).max(100) }).strict(), raw);
  if (roleKey === "SUPER_ADMIN") throw new AppError("FORBIDDEN", "Super Admin always has every permission.");
  if (actor.roles.has(roleKey)) throw new AppError("FORBIDDEN", "You cannot change the permissions of a role you hold.");
  // Only a Super Admin may put administration permissions on a role (prevents an Admin creating a more powerful role).
  const adminPerms = ["user.manage", "role.manage", "workflow.manage", "config.manage", "audit.view", "data.export"];
  return db.transaction(async (tx) => {
    const [role] = await tx.select().from(roles).where(eq(roles.key, roleKey));
    if (!role) throw notFound("Role");
    const valid = await tx.select({ key: permissions.key }).from(permissions).where(inArray(permissions.key, permissionKeys.length ? permissionKeys : ["-"]));
    if (valid.length !== new Set(permissionKeys).size) throw new AppError("VALIDATION", "Unknown permission.", { permissionKeys: "Invalid" });
    const before = (await tx.select({ k: rolePermissions.permissionKey }).from(rolePermissions).where(eq(rolePermissions.roleId, role.id))).map((x) => x.k).sort();
    const added = permissionKeys.filter((k) => !before.includes(k));
    if (!isSuper(actor) && added.some((k) => adminPerms.includes(k))) throw new AppError("FORBIDDEN", "Only a Super Admin can grant administration permissions.");
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
