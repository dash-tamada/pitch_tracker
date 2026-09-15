import { eq, inArray } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { createDb, type Db } from "@/server/db/client";
import { platforms, roles, userRoles, users } from "@/server/db/schema";
import { loadActor } from "@/server/modules/authz/actor";
import type { Actor, Clearance } from "@/server/modules/authz/policy";
import { createCreator } from "@/server/modules/creators/service";
import { createPitch } from "@/server/modules/pitches/service";
import { hashPassword } from "@/server/modules/auth/password";

let handle: ReturnType<typeof createDb> | undefined;
export function testDb(): Db {
  handle ??= createDb(process.env.TEST_DATABASE_URL!, 4);
  return handle.db;
}
export async function closeDb(): Promise<void> {
  await handle?.pool.end();
  handle = undefined;
}

export interface TestUser { id: string; email: string; actor: Actor }

export async function makeUser(db: Db, name: string, roleKeys: string[], opts: { clearance?: Clearance; password?: string } = {}): Promise<TestUser> {
  const email = `${name.toLowerCase().replace(/\W+/g, ".")}.${randomUUID().slice(0, 8)}@example.test`;
  const [u] = await db.insert(users).values({
    email, fullName: name, clearance: opts.clearance ?? "CONFIDENTIAL",
    passwordHash: opts.password ? await hashPassword(opts.password) : null,
  }).returning({ id: users.id });
  if (roleKeys.length) {
    const rs = await db.select({ id: roles.id }).from(roles).where(inArray(roles.key, roleKeys));
    await db.insert(userRoles).values(rs.map((r) => ({ userId: u!.id, roleId: r.id })));
  }
  const actor = (await loadActor(db, u!.id, true))!;
  return { id: u!.id, email, actor };
}

export async function makeTeam(db: Db) {
  return {
    employeeA: await makeUser(db, "Employee A", ["EMPLOYEE"]),
    employeeB: await makeUser(db, "Employee B", ["EMPLOYEE"]),
    employeeC: await makeUser(db, "Employee C", ["EMPLOYEE"]),
    outsider: await makeUser(db, "Unrelated Employee", ["EMPLOYEE"]),
    senior: await makeUser(db, "Senior Employee", ["SENIOR_EMPLOYEE"]),
    ceo: await makeUser(db, "CEO", ["CEO"], { clearance: "RESTRICTED" }),
    coo: await makeUser(db, "COO", ["COO"], { clearance: "RESTRICTED" }),
    admin: await makeUser(db, "Admin", ["ADMIN"]),
    viewer: await makeUser(db, "Viewer", ["VIEWER"]),
  };
}

export async function makePitch(db: Db, by: TestUser, overrides: Record<string, unknown> = {}) {
  const creator = await createCreator(db, by.actor, {
    creatorType: "WRITER_DIRECTOR", fullName: `Ravi Kumar ${randomUUID().slice(0, 6)}`,
  });
  return createPitch(db, by.actor, {
    title: "The Last Journey", formatKey: "WEB_SERIES", languageKey: "TELUGU", genreKey: "THRILLER",
    creatorId: creator.id, ...overrides,
  });
}

export async function platformId(db: Db, name: string): Promise<string> {
  const [p] = await db.select({ id: platforms.id }).from(platforms).where(eq(platforms.name, name));
  return p!.id;
}
