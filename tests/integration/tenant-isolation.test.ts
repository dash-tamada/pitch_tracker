/**
 * Cross-tenant abuse cases. Company A and Company B are provisioned by global-setup through the production code paths.
 * Every test tries to reach the other company's data by changing identifiers, contexts or roles.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import pg from "pg";
import { createDb, withCompany } from "@/server/db/client";
import { auditLogs, creators, pitches, sessions, subscriptions, users } from "@/server/db/schema";
import { login, resolveSession } from "@/server/modules/auth/service";
import { loadActor } from "@/server/modules/authz/actor";
import { createCreator, getCreatorProfile, listCreators } from "@/server/modules/creators/service";
import { createUploadIntent, downloadVersion } from "@/server/modules/documents/service";
import { reconcileProjections, followUpReminders } from "@/server/modules/jobs/runner";
import { createCompany, requestSupportAccess, setCompanyStatus, supportView, updateSubscription, listCompanies, platformAudit } from "@/server/modules/platform/service";
import { createPitch, getPitchDetail, listPitches } from "@/server/modules/pitches/service";
import { globalSearch } from "@/server/modules/search/service";
import { MemoryStorage } from "@/server/modules/storage/memory";
import { addEmailException, getMyCompany } from "@/server/modules/tenancy/company";
import { acceptInvitation } from "@/server/modules/tenancy/invitations";
import { createUser, updateUser } from "@/server/modules/users/admin";
import { getTimeline, performAction } from "@/server/modules/workflow/engine";
import { closeDb, COMPANY_A, COMPANY_B, makePitch, makeTeam, makeUser, platformTestDb, testDb, testDbB } from "../helpers/db";

const dbA = testDb();
const dbB = testDbB();
const pdb = platformTestDb();
const code = async (p: Promise<unknown>) => { try { await p; return "OK"; } catch (e) { return (e as { code?: string }).code ?? (e as { cause?: { code?: string } }).cause?.code ?? String(e); } };
const tokenOf = (path: string) => path.split("#")[1]!;
const PASSWORD = "Monsoon-Rains-2026!";

let teamA: Awaited<ReturnType<typeof makeTeam>>;
let teamB: Awaited<ReturnType<typeof makeTeam>>;
let pitchA: { id: string; pitchCode: string; version: number };
let creatorA = "";
let platformActor: NonNullable<Awaited<ReturnType<typeof loadActor>>>;

beforeAll(async () => {
  teamA = await withCompany(COMPANY_A, () => makeTeam(dbA));
  teamB = await withCompany(COMPANY_B, () => makeTeam(dbB));
  pitchA = await makePitch(dbA, teamA.employeeA);
  const [p] = await dbA.select({ creatorId: pitches.creatorId }).from(pitches).where(eq(pitches.id, pitchA.id));
  creatorA = p!.creatorId;
  const [u] = await pdb.insert(users).values({ email: `platform.${Date.now()}@example.test`, fullName: "Platform Operator", scope: "PLATFORM", companyId: null, status: "ACTIVE" })
    .returning({ id: users.id });
  platformActor = (await loadActor(pdb, u!.id, true))!;
});
afterAll(closeDb);

describe("database-level isolation (row-level security on the app role)", () => {
  it("company B's connection cannot see, update or reference company A's rows, even by exact id", async () => {
    expect(await dbB.select({ id: pitches.id }).from(pitches).where(eq(pitches.id, pitchA.id))).toEqual([]);
    expect(await dbB.select({ id: creators.id }).from(creators).where(eq(creators.id, creatorA))).toEqual([]);
    const updated = await dbB.update(pitches).set({ title: "hijacked" }).where(eq(pitches.id, pitchA.id)).returning({ id: pitches.id });
    expect(updated).toEqual([]);
    // Writing a row labelled as company A from company B's context is rejected by the policy.
    expect(await code(dbB.insert(creators).values({ companyId: COMPANY_A, creatorType: "WRITER", fullName: "Planted", nameNormalized: "planted", createdById: teamB.admin.id })))
      .toBe("42501");
    // Linking company B data to company A's creator fails the composite foreign key / visibility checks.
    expect(await code(createPitch(dbB, teamB.employeeA.actor, { title: "Stolen", formatKey: "WEB_SERIES", languageKey: "TELUGU", creatorId: creatorA }))).toBe("VALIDATION");
  });

  it("an app-role connection without a company context sees nothing at all (fail closed)", async () => {
    const raw = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL });
    await raw.connect();
    try {
      for (const t of ["pitches", "creators", "users", "audit_logs", "notifications", "companies"]) {
        const { rows } = await raw.query(`SELECT count(*)::int AS n FROM public.${t}`);
        expect(rows[0].n, t).toBe(0);
      }
      // A company context set inside one transaction does not leak into the next statement on the same connection.
      await raw.query("BEGIN"); await raw.query(`SELECT set_config('app.company_id', $1, true)`, [COMPANY_A]);
      expect((await raw.query("SELECT count(*)::int AS n FROM public.pitches")).rows[0].n).toBeGreaterThan(0);
      await raw.query("COMMIT");
      expect((await raw.query("SELECT count(*)::int AS n FROM public.pitches")).rows[0].n).toBe(0);
    } finally {
      await raw.end();
    }
  });

  it("the platform role has no access to scripts, pitches or creators", async () => {
    expect(await code(pdb.select({ id: pitches.id }).from(pitches).limit(1))).toBe("42501");
    expect(await code(pdb.select({ id: creators.id }).from(creators).limit(1))).toBe("42501");
  });

  it("company work cannot read password hashes or plant credentials", async () => {
    expect(await code(dbA.select({ h: users.passwordHash }).from(users).limit(1))).toBe("42501");
    expect(await code(dbA.insert(users).values({ email: `planted.${Date.now()}@example.test`, fullName: "Planted", passwordHash: "$argon2id$x" }))).toBe("42501");
    expect(await code(dbA.insert(users).values({ email: `root.${Date.now()}@example.test`, fullName: "Root", scope: "PLATFORM" }))).toBe("42501");
  });
});

describe("service-level isolation (IDOR by changing identifiers)", () => {
  it("company B users get NOT_FOUND for company A's pitch, timeline, actions and creator", async () => {
    const outsider = teamB.ceo.actor; // most powerful content role in B
    expect(await code(getPitchDetail(dbB, outsider, pitchA.id))).toBe("NOT_FOUND");
    expect(await code(getTimeline(dbB, outsider, pitchA.id))).toBe("NOT_FOUND");
    expect(await code(performAction(dbB, outsider, pitchA.id, { action: "REJECT", expectedVersion: pitchA.version, rejectionCategoryKey: "OTHER", rejectionReason: "Cross-company attempt" }))).toBe("NOT_FOUND");
    expect(await code(getCreatorProfile(dbB, teamB.senior.actor, creatorA))).toBe("NOT_FOUND");
    expect(await code(createUploadIntent(dbB, new MemoryStorage(), teamB.employeeA.actor, { kind: "DOCUMENT", pitchId: pitchA.id, categoryKey: "SCRIPT", title: "x", filename: "x.pdf", sizeBytes: 10 }))).toBe("NOT_FOUND");
    expect(await code(downloadVersion(dbB, new MemoryStorage(), outsider, "00000000-0000-4000-8000-000000000000"))).toBe("NOT_FOUND");
  });

  it("a company A actor used on company B's connection still cannot see company A data (context wins over actor)", async () => {
    expect(await code(getPitchDetail(dbB, teamA.ceo.actor, pitchA.id))).toBe("NOT_FOUND");
  });

  it("lists, search and analytics never include the other company", async () => {
    const listB = await listPitches(dbB, teamB.ceo.actor, {});
    expect(listB.items.some((p: { id: string }) => p.id === pitchA.id)).toBe(false);
    const search = await globalSearch(dbB, teamB.ceo.actor, { q: "Last Journey" });
    expect(JSON.stringify(search)).not.toContain(pitchA.id);
    const creatorsB = await listCreators(dbB, teamB.senior.actor, {});
    expect(creatorsB.items.some((c) => c.id === creatorA)).toBe(false);
  });

  it("the same creator mobile and email can exist in two companies; pitch codes are numbered per company", async () => {
    const mobile = "+919000077777";
    await createCreator(dbA, teamA.senior.actor, { creatorType: "WRITER", fullName: "Shared Writer", mobile, email: "shared.writer@example.test" });
    await createCreator(dbB, teamB.senior.actor, { creatorType: "WRITER", fullName: "Shared Writer", mobile, email: "shared.writer@example.test" });
    const pB = await makePitch(dbB, teamB.employeeA);
    expect(pB.pitchCode).toMatch(/^BETA-\d{4}-\d{6}$/);
    expect(pitchA.pitchCode).toMatch(/^ALPHA-\d{4}-\d{6}$/);
  });

  it("jobs run per company: company B's reconciliation checks only company B's pitches", async () => {
    const [countB] = await dbB.select({ n: sql<number>`count(*)::int` }).from(pitches);
    expect((await reconcileProjections(dbB)).checked).toBe(countB!.n);
    expect(await followUpReminders(dbB)).toEqual({ sent: 0 });
  });
});

describe("identity, invitations and email policy", () => {
  it("sessions carry the user's company; the company comes only from the server", async () => {
    const u = await makeUser(dbB, "Beta Session", ["EMPLOYEE"], { password: PASSWORD });
    const s = await login(pdb, { email: u.email, password: PASSWORD }, { ip: "10.20.0.1" });
    const session = await resolveSession(pdb, s.token);
    expect(session?.actor.companyId).toBe(COMPANY_B);
    expect(session?.actor.scope).toBe("COMPANY");
  });

  it("invites must match the company domain or an audited exception; addresses from other companies cannot be taken", async () => {
    expect(await code(createUser(dbA, teamA.admin.actor, { email: "someone@gmail.com", fullName: "Outside Person", roleKeys: ["EMPLOYEE"] }))).toBe("VALIDATION");
    expect(await code(addEmailException(dbA, teamA.admin.actor, { email: "someone@gmail.com", reason: "Freelance script consultant" }))).toBe("FORBIDDEN"); // company.manage only
    const companyAdmin = await makeUser(dbA, "Alpha Owner", ["COMPANY_ADMIN"], { clearance: "RESTRICTED" });
    await addEmailException(dbA, companyAdmin.actor, { email: "someone@gmail.com", reason: "Freelance script consultant" });
    const r = await createUser(dbA, teamA.admin.actor, { email: "someone@gmail.com", fullName: "Outside Person", roleKeys: ["EMPLOYEE"] });
    expect(r.invitePath).toMatch(/^\/accept-invite#/);
    // teamB's employee email exists in company B; company A cannot invite it and is not told where it lives.
    await addEmailException(dbA, companyAdmin.actor, { email: teamB.employeeA.email, reason: "Attempt to claim another tenant's user" });
    const err = await createUser(dbA, teamA.admin.actor, { email: teamB.employeeA.email, fullName: "Claimed", roleKeys: ["EMPLOYEE"] }).catch((e: Error) => e);
    expect((err as { code?: string }).code).toBe("CONFLICT");
    expect((err as Error).message).not.toMatch(/beta/i);
    const audit = await dbA.select({ action: auditLogs.action }).from(auditLogs).where(eq(auditLogs.action, "security.email_exception_added"));
    expect(audit.length).toBeGreaterThanOrEqual(2);
  });

  it("plan limits are enforced on the server from the database", async () => {
    const [{ n }] = await dbB.select({ n: sql<number>`count(*)::int` }).from(users).where(sql`status IN ('ACTIVE','INVITED') AND archived_at IS NULL`) as [{ n: number }];
    await updateSubscription(pdb, platformActor, COMPANY_B, { limitOverrides: { max_users: n } });
    expect(await code(createUser(dbB, teamB.admin.actor, { email: "one.more@beta.example.test", fullName: "One More", roleKeys: ["EMPLOYEE"] }))).toBe("PLAN_LIMIT");
    await updateSubscription(pdb, platformActor, COMPANY_B, { limitOverrides: {} });
    expect(await code(createUser(dbB, teamB.admin.actor, { email: "one.more@beta.example.test", fullName: "One More", roleKeys: ["EMPLOYEE"] }))).toBe("OK");
  });

  it("disabling an owner requires reassignment; pitches move through the workflow log with no projection drift", async () => {
    const owner = await makeUser(dbA, "Leaving Employee", ["EMPLOYEE"]);
    const p = await makePitch(dbA, owner);
    expect(await code(updateUser(dbA, teamA.admin.actor, owner.id, { status: "DISABLED" }))).toBe("CONFLICT");
    const r = await updateUser(dbA, teamA.admin.actor, owner.id, { status: "DISABLED", reassignToUserId: teamA.employeeB.id });
    expect(r.reassignedPitches).toBeGreaterThanOrEqual(1);
    const [row] = await dbA.select({ ownerId: pitches.currentOwnerId }).from(pitches).where(eq(pitches.id, p.id));
    expect(row!.ownerId).toBe(teamA.employeeB.id);
    expect((await reconcileProjections(dbA)).drift).toBe(0);
  });
});

describe("platform Super Admin", () => {
  it("company accounts cannot call platform functions; platform accounts cannot reach company content", async () => {
    expect(await code(listCompanies(pdb, teamA.admin.actor))).toBe("FORBIDDEN");
    const companies = await listCompanies(pdb, platformActor);
    expect(companies.map((c) => c.code)).toEqual(expect.arrayContaining(["ALPHA", "BETA"]));
    expect(JSON.stringify(companies)).not.toMatch(/Last Journey|synopsis/i); // counts only
  });

  it("creates a company, provisions defaults and invites its first Company Admin, who can then sign in", async () => {
    const created = await createCompany(pdb, platformActor, { code: "GAMMA", name: "Gamma Talkies", planKey: "STARTER", emailDomains: ["gamma.example.test"],
      adminEmail: "owner@gamma.example.test", adminFullName: "Gamma Owner" });
    await acceptInvitation(pdb, { token: tokenOf(created.invitePath), password: PASSWORD });
    const s = await login(pdb, { email: "owner@gamma.example.test", password: PASSWORD }, { ip: "10.30.0.1" });
    expect(s.mfaRequired).toBe(true); // Company Admin must use MFA
    const session = await resolveSession(pdb, s.token);
    expect(session?.actor.companyId).toBe(created.id);
    expect(session?.actor.roles.has("COMPANY_ADMIN")).toBe(true);
    expect(await code(createCompany(pdb, platformActor, { code: "GAMMA", name: "Dup", planKey: "STARTER", adminEmail: "x@gamma2.example.test", adminFullName: "Dup Owner" }))).toBe("CONFLICT");
  });

  it("suspending a company revokes its sessions and blocks sign-in; reactivating restores access", async () => {
    const u = await makeUser(dbB, "Beta Suspended", ["EMPLOYEE"], { password: PASSWORD });
    const s = await login(pdb, { email: u.email, password: PASSWORD }, { ip: "10.40.0.1" });
    const r = await setCompanyStatus(pdb, platformActor, COMPANY_B, { status: "SUSPENDED", reason: "Invoice overdue" });
    expect(r.sessionsRevoked).toBeGreaterThanOrEqual(1);
    expect(await resolveSession(pdb, s.token)).toBeNull();
    expect(await code(login(pdb, { email: u.email, password: PASSWORD }, { ip: "10.40.0.1" }))).toBe("COMPANY_UNAVAILABLE");
    await setCompanyStatus(pdb, platformActor, COMPANY_B, { status: "ACTIVE", reason: "Payment received" });
    expect(await code(login(pdb, { email: u.email, password: PASSWORD }, { ip: "10.40.0.2" }))).toBe("OK");
    const [revoked] = await pdb.select({ n: sql<number>`count(*)::int` }).from(sessions).where(eq(sessions.userId, u.id));
    expect(revoked!.n).toBe(2);
  });

  it("support access needs a reason and a live grant, shows configuration only, and is audited for the company", async () => {
    expect(await code(supportView(pdb, platformActor, COMPANY_A))).toBe("FORBIDDEN");
    expect(await code(requestSupportAccess(pdb, platformActor, COMPANY_A, { reason: "short" }))).toBe("VALIDATION");
    await requestSupportAccess(pdb, platformActor, COMPANY_A, { reason: "Customer reported sign-in problems (ticket 42)", minutes: 30 });
    const view = await supportView(pdb, platformActor, COMPANY_A);
    expect(Object.keys(view).sort()).toEqual(["grant", "people", "recentActivity", "roles", "settings"]);
    expect(JSON.stringify(view)).not.toMatch(/password_hash|passwordHash|mfaSecret|Last Journey/);
    const companyTrail = await dbA.select({ action: auditLogs.action }).from(auditLogs).where(eq(auditLogs.action, "support.viewed"));
    expect(companyTrail.length).toBe(1);
    const platformTrail = await platformAudit(pdb, platformActor, { action: "support." });
    expect(platformTrail.items.map((i) => i.action)).toEqual(expect.arrayContaining(["support.access_granted", "support.viewed"]));
  });

  it("platform audit excludes company business events", async () => {
    const trail = await platformAudit(pdb, platformActor, {});
    expect(trail.items.some((i) => i.action.startsWith("pitch.") || i.action.startsWith("workflow."))).toBe(false);
  });

  it("company admin sees own plan and usage only", async () => {
    const owner = await makeUser(dbB, "Beta Owner", ["COMPANY_ADMIN"], { clearance: "RESTRICTED" });
    const mine = await getMyCompany(dbB, owner.actor);
    expect(mine.company.code).toBe("BETA");
    const [sub] = await pdb.select({ planKey: subscriptions.planKey }).from(subscriptions).where(eq(subscriptions.companyId, COMPANY_B));
    expect(mine.subscription.planKey).toBe(sub!.planKey);
  });
});

void createDb;
