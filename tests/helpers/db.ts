import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { createCreatorDb, createDb, createPool, createTenantDb, setCreatorAppPoolForTests, type Db } from "@/server/db/client";
import { companies, platforms } from "@/server/db/schema";
import { createActiveUser } from "@/server/modules/tenancy/bootstrap";
import { COMPANY_A, COMPANY_B } from "./tenants";
import { loadActor } from "@/server/modules/authz/actor";
import type { Actor, Clearance } from "@/server/modules/authz/policy";
import { createCreator } from "@/server/modules/creators/service";
import { createPitch } from "@/server/modules/pitches/service";
import { hashToken, newToken } from "@/server/modules/auth/tokens";

export { COMPANY_A, COMPANY_B };

let appPool: ReturnType<typeof createPool> | undefined;
let platform: ReturnType<typeof createDb> | undefined;
let creatorPool: ReturnType<typeof createPool> | undefined;
const tenants = new Map<string, Db>();
const creatorTenants = new Map<string, Db>();

/** Company-scoped handle (pitch_app + row-level security) for company A unless another company id is given. */
export function testDb(companyId: string = COMPANY_A): Db {
  appPool ??= createPool(process.env.TEST_DATABASE_URL!, 4);
  let db = tenants.get(companyId);
  if (!db) { db = createTenantDb(appPool, companyId); tenants.set(companyId, db); }
  return db;
}
export const testDbB = () => testDb(COMPANY_B);

/** Identity/platform handle (pitch_platform): sign-in, sessions, companies. No access to company content. */
export function platformTestDb(): Db {
  platform ??= createDb(process.env.TEST_PLATFORM_DATABASE_URL!, 2);
  return platform.db;
}

/** Creator-portal handle (pitch_creator + row-level security), scoped to one company and (once known) one creator. */
export function creatorTestDb(companyId: string, creatorId: string | null): Db {
  ensureCreatorPool();
  const key = `${companyId}:${creatorId ?? "-"}`;
  let db = creatorTenants.get(key);
  if (!db) { db = createCreatorDb(creatorPool!, companyId, creatorId); creatorTenants.set(key, db); }
  return db;
}

/**
 * Points the app's own creator-portal singletons (getCreatorAnonDb/creatorDb in db/client.ts, used
 * directly by src/server/modules/creator-portal/auth.ts) at the test database. Without this, that module
 * would connect to CREATOR_DATABASE_URL (the dev database) instead of TEST_CREATOR_DATABASE_URL, since it
 * is not written to take a Db parameter the way the staff services are (see setCreatorAppPoolForTests's
 * own doc comment for why). Idempotent; call it once, e.g. from a test file's top level or beforeAll.
 */
export function ensureCreatorPool(): void {
  if (creatorPool) return;
  creatorPool = createPool(process.env.TEST_CREATOR_DATABASE_URL!, 4);
  setCreatorAppPoolForTests(creatorPool);
}

export async function closeDb(): Promise<void> {
  await appPool?.end();
  await platform?.pool.end();
  await creatorPool?.end();
  appPool = undefined; platform = undefined; creatorPool = undefined; tenants.clear(); creatorTenants.clear();
}

/** Generates and stores a fresh creator-portal link for a company (bypasses the staff API); returns the plain token. */
export async function makePortalLink(companyId: string = COMPANY_A): Promise<string> {
  ensureCreatorPool(); // registerCreator/loginCreator/etc. must resolve against the test database, not dev
  const token = newToken();
  await testDb(companyId).update(companies).set({ creatorPortalTokenHash: hashToken(token) }).where(eq(companies.id, companyId));
  return token;
}

export interface TestUser { id: string; email: string; actor: Actor }

export async function makeUser(db: Db, name: string, roleKeys: string[], opts: { clearance?: Clearance; password?: string } = {}): Promise<TestUser> {
  const email = `${name.toLowerCase().replace(/\W+/g, ".")}.${randomUUID().slice(0, 8)}@example.test`;
  const id = await createActiveUser(platformTestDb(), db, { email, fullName: name, roleKeys, clearance: opts.clearance ?? "CONFIDENTIAL", password: opts.password });
  const actor = (await loadActor(db, id, true))!;
  return { id, email, actor };
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
