import { and, eq, inArray, isNull } from "drizzle-orm";
import type { DbOrTx } from "@/server/db/client";
import { rolePermissions, roles, userRoles, users } from "@/server/db/schema";
import type { Actor, Clearance } from "./policy";

export interface LoadedUser {
  id: string;
  status: string;
  clearance: Clearance;
  roles: Set<string>;
  permissions: Set<string>;
}

/** Loads roles and effective permissions for a set of users (one query per table, no N+1). */
export async function loadUsersWithPermissions(db: DbOrTx, userIds: readonly string[]): Promise<Map<string, LoadedUser>> {
  const out = new Map<string, LoadedUser>();
  if (userIds.length === 0) return out;
  const rows = await db.select({ id: users.id, status: users.status, clearance: users.clearance })
    .from(users).where(and(inArray(users.id, [...userIds]), isNull(users.archivedAt)));
  for (const r of rows) out.set(r.id, { ...r, roles: new Set(), permissions: new Set() });

  const grants = await db.select({ userId: userRoles.userId, roleKey: roles.key, perm: rolePermissions.permissionKey })
    .from(userRoles)
    .innerJoin(roles, eq(roles.id, userRoles.roleId))
    .leftJoin(rolePermissions, eq(rolePermissions.roleId, roles.id))
    .where(inArray(userRoles.userId, [...userIds]));
  for (const g of grants) {
    const u = out.get(g.userId);
    if (!u) continue;
    u.roles.add(g.roleKey);
    if (g.perm) u.permissions.add(g.perm);
  }
  return out;
}

export async function loadActor(db: DbOrTx, userId: string, mfaSatisfied: boolean): Promise<Actor | null> {
  const u = (await loadUsersWithPermissions(db, [userId])).get(userId);
  if (!u || u.status !== "ACTIVE") return null;
  return { userId: u.id, roles: u.roles, permissions: u.permissions, clearance: u.clearance, mfaSatisfied };
}
