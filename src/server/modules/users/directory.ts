import { and, asc, eq, ilike, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/server/db/client";
import { roles, userRoles, users } from "@/server/db/schema";
import { AppError } from "@/server/lib/errors";
import { parseInput } from "@/server/lib/validation";
import { can, type Actor } from "@/server/modules/authz/policy";
import { escapeLike } from "@/server/modules/creators/service";

const schema = z.object({
  q: z.string().trim().max(80).optional(),
  roles: z.string().max(200).optional().transform((v) => v?.split(",").map((s) => s.trim()).filter(Boolean)),
}).strict();

/** Colleague picker for forwarding/assigning: active users' names and role keys only (no emails, no clearance). */
export async function userDirectory(db: Db, actor: Actor, raw: unknown) {
  if (!can(actor, "pitch.view") && !can(actor, "pitch.view_all") && !can(actor, "user.manage")) throw new AppError("FORBIDDEN", "Not allowed.");
  const f = parseInput(schema, raw);
  const conds = [eq(users.status, "ACTIVE"), isNull(users.archivedAt)];
  if (f.q) conds.push(ilike(users.fullName, `%${escapeLike(f.q)}%`));
  const rows = await db.select({ id: users.id, fullName: users.fullName, roleKey: roles.key })
    .from(users).innerJoin(userRoles, eq(userRoles.userId, users.id)).innerJoin(roles, eq(roles.id, userRoles.roleId))
    .where(and(...conds, ...(f.roles?.length ? [inArray(roles.key, f.roles)] : []))).orderBy(asc(users.fullName)).limit(300);
  const byId = new Map<string, { id: string; fullName: string; roles: string[] }>();
  for (const r of rows) {
    const u = byId.get(r.id) ?? { id: r.id, fullName: r.fullName, roles: [] };
    u.roles.push(r.roleKey);
    byId.set(r.id, u);
  }
  return [...byId.values()];
}
