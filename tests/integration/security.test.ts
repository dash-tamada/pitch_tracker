/** Abuse cases against the real database with the least-privilege app role. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { auditLogs, pitchParticipants, pitches, platforms, sessions, users, workflowEvents } from "@/server/db/schema";
import { changeOwnPassword, login, logout, resolveSession, LOCKOUT_THRESHOLD, SESSION_IDLE_MS } from "@/server/modules/auth/service";
import { hashPassword } from "@/server/modules/auth/password";
import { encryptSecret, hotp, newTotpSecret, stepAt } from "@/server/modules/auth/totp";
import { canViewPitch, pitchVisibilityCondition } from "@/server/modules/authz/policy";
import { findCreatorMatches, createCreator } from "@/server/modules/creators/service";
import { createPitch } from "@/server/modules/pitches/service";
import { getAvailableActions, getTimeline, performAction } from "@/server/modules/workflow/engine";
import { closeDb, makePitch, makeTeam, makeUser, platformTestDb, testDb } from "../helpers/db";

const db = testDb();
const pdb = platformTestDb();
let team: Awaited<ReturnType<typeof makeTeam>>;
let pitchId = "";

const errCode = async (p: Promise<unknown>) => { try { await p; return "OK"; } catch (e) { return (e as { code?: string }).code ?? String(e); } };

beforeAll(async () => {
  team = await makeTeam(db);
  const p = await makePitch(db, team.employeeA);
  pitchId = p.id;
  await performAction(db, team.employeeA.actor, pitchId, { action: "ASSIGN", expectedVersion: 1, recipientId: team.employeeA.id });
});
afterAll(closeDb);

describe("IDOR / broken access control", () => {
  it("an uninvolved employee gets NOT_FOUND for timeline, actions and mutations", async () => {
    expect(await errCode(getTimeline(db, team.outsider.actor, pitchId))).toBe("NOT_FOUND");
    expect(await errCode(getAvailableActions(db, team.outsider.actor, pitchId))).toBe("NOT_FOUND");
    expect(await errCode(performAction(db, team.outsider.actor, pitchId, { action: "REJECT", expectedVersion: 2,
      rejectionCategoryKey: "WEAK_STORY", rejectionReason: "I should not be able to do this" }))).toBe("NOT_FOUND");
  });
  it("a random UUID and a non-existent pitch look identical (no existence oracle)", async () => {
    expect(await errCode(getTimeline(db, team.outsider.actor, "00000000-0000-4000-8000-000000000000"))).toBe("NOT_FOUND");
  });
  it("admin cannot open pitches (separation of duties)", async () => {
    expect(await errCode(getTimeline(db, team.admin.actor, pitchId))).toBe("NOT_FOUND");
  });
  it("SQL visibility filter matches canViewPitch for every user × pitch", async () => {
    const restricted = await makePitch(db, team.ceo, { confidentiality: "RESTRICTED", title: "Secret Project" });
    const archivedP = await makePitch(db, team.senior, { title: "Old Story" });
    await db.update(pitches).set({ archivedAt: new Date() }).where(eq(pitches.id, archivedP.id));
    const all = await db.select().from(pitches);
    for (const u of Object.values(team)) {
      const visibleSql = new Set((await db.select({ id: pitches.id }).from(pitches).where(pitchVisibilityCondition(u.actor, true))).map((r) => r.id));
      const defaultList = new Set((await db.select({ id: pitches.id }).from(pitches).where(pitchVisibilityCondition(u.actor))).map((r) => r.id));
      expect(defaultList.has(archivedP.id), "archived hidden from default lists").toBe(false);
      for (const p of all) {
        const reasons = (await db.select({ r: pitchParticipants.reason }).from(pitchParticipants)
          .where(and(eq(pitchParticipants.pitchId, p.id), eq(pitchParticipants.userId, u.id)))).map((x) => x.r);
        expect(visibleSql.has(p.id), `${u.email} / ${p.title}`).toBe(canViewPitch(u.actor, { ...p, participantReasons: reasons }));
      }
    }
    expect(canViewPitch(team.senior.actor, { ...restricted, confidentiality: "RESTRICTED", currentOwnerId: team.ceo.id, archivedAt: null, participantReasons: [] })).toBe(false);
  });
});

describe("workflow integrity", () => {
  it("cannot skip straight to platform / greenlight via the API (Kanban/URL bypass)", async () => {
    for (const action of ["SEND_TO_PLATFORM", "GREENLIGHT", "MARK_PLATFORM_APPROVED", "ADVANCE"]) {
      expect(await errCode(performAction(db, team.employeeA.actor, pitchId, { action, expectedVersion: 2, remarks: "x" }))).toBe("TRANSITION_NOT_ALLOWED");
    }
  });
  it("tracker-bound steps cannot be taken through the generic action endpoint, even at the right stage", async () => {
    const p = await makePitch(db, team.employeeA, { title: "Tracker bypass" });
    let v = p.version;
    const step = async (who: typeof team.employeeA, b: Record<string, unknown>) => { v = (await performAction(db, who.actor, p.id, { expectedVersion: v, ...b })).version; };
    await step(team.employeeA, { action: "ASSIGN", recipientId: team.employeeA.id });
    await step(team.employeeA, { action: "FORWARD", toStageKey: "EXECUTIVE_REVIEW", recipientId: team.ceo.id, remarks: "up" });
    await step(team.ceo, { action: "SEND_TO_PLATFORM", recipientId: team.senior.id, remarks: "go" });
    const netflix = (await db.select().from(platforms)).find((x) => x.name === "Netflix")!.id;
    expect(await errCode(performAction(db, team.senior.actor, p.id, { action: "RECORD_PLATFORM_PITCH", expectedVersion: v, platformId: netflix }))).toBe("TRANSITION_NOT_ALLOWED");
  });
  it("CEO cannot act at an employee's review level unless configured", async () => {
    expect(await errCode(performAction(db, team.ceo.actor, pitchId, { action: "ACCEPT", expectedVersion: 2, remarks: "x", recipientId: team.coo.id })))
      .toBe("NOT_CURRENT_OWNER");
  });
  it("mass assignment: extra fields are rejected", async () => {
    expect(await errCode(performAction(db, team.employeeA.actor, pitchId, { action: "HOLD", expectedVersion: 2, remarks: "x", currentOwnerId: team.outsider.id })))
      .toBe("VALIDATION");
  });
  it("rejection without a reason fails in the engine AND in the database", async () => {
    expect(await errCode(performAction(db, team.employeeA.actor, pitchId, { action: "REJECT", expectedVersion: 2, rejectionCategoryKey: "WEAK_STORY" })))
      .toBe("VALIDATION");
    expect(await errCode(performAction(db, team.employeeA.actor, pitchId, { action: "REJECT", expectedVersion: 2, rejectionCategoryKey: "NOT_A_CATEGORY", rejectionReason: "Long enough reason here" })))
      .toBe("VALIDATION");
    const direct = db.insert(workflowEvents).values({ pitchId, seq: 99, action: "REJECT", toStageKey: "REJECTED", actorId: team.employeeA.id });
    const dbErr = await direct.then(() => null, (e: { cause?: { constraint?: string } }) => e);
    expect(dbErr?.cause?.constraint).toBe("workflow_events_reject_reason_ck");
  });
  it("stale version is refused (two reviewers acting at once)", async () => {
    expect(await errCode(performAction(db, team.employeeA.actor, pitchId, { action: "HOLD", expectedVersion: 1, remarks: "x" }))).toBe("STALE_VERSION");
  });
  it("self-approval is blocked for the CEO's own pitch", async () => {
    const own = await makePitch(db, team.ceo, { title: "CEO's Own Idea" });
    let v = own.version;
    const step = async (body: Record<string, unknown>, who = team.ceo) => { v = (await performAction(db, who.actor, own.id, { expectedVersion: v, ...body })).version; };
    await step({ action: "ASSIGN", recipientId: team.employeeB.id });
    await step({ action: "FORWARD", toStageKey: "EXECUTIVE_REVIEW", recipientId: team.ceo.id, remarks: "up" }, team.employeeB);
    expect(await errCode(performAction(db, team.ceo.actor, own.id, { action: "SEND_TO_PLATFORM", expectedVersion: v, recipientId: team.senior.id, remarks: "mine" })))
      .toBe("SELF_APPROVAL_BLOCKED");
    // the COO can approve it instead
    expect(await errCode(performAction(db, team.coo.actor, own.id, { action: "SEND_TO_PLATFORM", expectedVersion: v, recipientId: team.senior.id, remarks: "ok" })))
      .toBe("OK");
  });
  it("employee cannot create a pitch above their clearance and lose access to it", async () => {
    expect(await errCode(makePitch(db, team.employeeA, { confidentiality: "RESTRICTED" }))).toBe("VALIDATION");
  });
  it("exec session without MFA cannot act", async () => {
    const noMfa = { ...team.coo.actor, mfaSatisfied: false };
    expect(await errCode(performAction(db, noMfa, pitchId, { action: "HOLD", expectedVersion: 2, remarks: "x" }))).toBe("MFA_REQUIRED");
  });
});

describe("immutability enforced by PostgreSQL for the app role", () => {
  it("workflow events cannot be edited or deleted", async () => {
    await expect(db.update(workflowEvents).set({ remarks: "rewritten history" }).where(eq(workflowEvents.pitchId, pitchId))).rejects.toThrow();
    await expect(db.delete(workflowEvents).where(eq(workflowEvents.pitchId, pitchId))).rejects.toThrow();
  });
  it("audit logs cannot be edited or deleted", async () => {
    await expect(db.update(auditLogs).set({ action: "x" })).rejects.toThrow();
    await expect(db.execute(sql`DELETE FROM audit_logs`)).rejects.toThrow();
  });
  it("pitches cannot be hard-deleted and the app role cannot run DDL", async () => {
    await expect(db.delete(pitches).where(eq(pitches.id, pitchId))).rejects.toThrow();
    await expect(db.execute(sql`DROP TABLE audit_logs`)).rejects.toThrow();
    await expect(db.execute(sql`ALTER TABLE workflow_events DISABLE TRIGGER ALL`)).rejects.toThrow();
  });
});

describe("injection & PII", () => {
  it("SQL metacharacters in search are treated as data", async () => {
    await createCreator(db, team.senior.actor, { creatorType: "WRITER", fullName: "Robert'); DROP TABLE creators;--", mobile: "9876512345", email: "rob@example.com" });
    const hits = await findCreatorMatches(db, team.senior.actor, { name: "Robert'); DROP TABLE creators;--" });
    expect(hits.length).toBeGreaterThan(0);
  });
  it("employees see masked mobile/email; senior sees full", async () => {
    const [emp] = await findCreatorMatches(db, team.employeeA.actor, { mobile: "9876512345" });
    const [sen] = await findCreatorMatches(db, team.senior.actor, { mobile: "9876512345" });
    expect(emp!.mobile).toBe("+91 XXXXX 12345");
    expect(emp!.email).toBe("r***@example.com");
    expect(sen!.mobile).toBe("+919876512345");
  });
  it("duplicate creator by mobile in another format is refused", async () => {
    expect(await errCode(createCreator(db, team.senior.actor, { creatorType: "DIRECTOR", fullName: "Someone Else", mobile: "+91 98765 12345" }))).toBe("CONFLICT");
  });
  it("creator website must be http(s) — javascript: URLs rejected", async () => {
    expect(await errCode(createCreator(db, team.senior.actor, { creatorType: "WRITER", fullName: "Xss Test", website: "javascript:alert(1)" }))).not.toBe("OK");
  });
  it("viewer cannot create pitches", async () => {
    expect(await errCode(createPitch(db, team.viewer.actor, { title: "x", formatKey: "WEB_SERIES", languageKey: "TELUGU", creatorId: pitchId }))).toBe("FORBIDDEN");
  });
});

describe("authentication", () => {
  const password = "Monsoon-Rains-2026!";
  it("login works, stores only a hashed token, and logout revokes", async () => {
    const u = await makeUser(db, "Login User", ["EMPLOYEE"], { password });
    const res = await login(pdb, { email: u.email.toUpperCase(), password }, { ip: "10.0.0.1" });
    const [s] = await db.select().from(sessions).where(eq(sessions.userId, u.id));
    expect(s!.tokenHash.toString("base64url")).not.toBe(res.token);
    expect((await resolveSession(pdb, res.token))?.actor.userId).toBe(u.id);
    await logout(pdb, res.token);
    expect(await resolveSession(pdb, res.token)).toBeNull();
  });
  it("wrong password and unknown email return the same error", async () => {
    const u = await makeUser(db, "Enum User", ["EMPLOYEE"], { password });
    expect(await errCode(login(pdb, { email: u.email, password: "Wrong-Password-1!" }, { ip: "10.0.0.2" }))).toBe("INVALID_CREDENTIALS");
    expect(await errCode(login(pdb, { email: "nobody@example.test", password: "Wrong-Password-1!" }, { ip: "10.0.0.2" }))).toBe("INVALID_CREDENTIALS");
  });
  it(`locks the account after ${LOCKOUT_THRESHOLD} failures, even with the right password`, async () => {
    const u = await makeUser(db, "Lock User", ["EMPLOYEE"], { password });
    for (let i = 0; i < LOCKOUT_THRESHOLD; i++) await errCode(login(pdb, { email: u.email, password: "Nope-Nope-123!" }, { ip: "10.0.0.3" }));
    expect(await errCode(login(pdb, { email: u.email, password }, { ip: "10.0.0.3" }))).toBe("ACCOUNT_LOCKED");
  });
  it("rate-limits an IP spraying many accounts", async () => {
    let last = "";
    for (let i = 0; i < 32; i++) last = await errCode(login(pdb, { email: `spray${i}@example.test`, password: "Spray-Spray-123!" }, { ip: "10.9.9.9" }));
    expect(last).toBe("RATE_LIMITED");
  });
  it("idle sessions expire; disabled users lose access immediately", async () => {
    const u = await makeUser(db, "Idle User", ["EMPLOYEE"], { password });
    const res = await login(pdb, { email: u.email, password }, { ip: "10.0.0.4" });
    expect(await resolveSession(pdb, res.token, new Date(Date.now() + SESSION_IDLE_MS + 1000))).toBeNull();
    const res2 = await login(pdb, { email: u.email, password }, { ip: "10.0.0.4" });
    await db.update(users).set({ status: "DISABLED" }).where(eq(users.id, u.id));
    expect(await resolveSession(pdb, res2.token)).toBeNull();
  });
  it("company-side CEO login does not force MFA (removed for company roles — see MFA_REQUIRED_ROLES)", async () => {
    const u = await makeUser(db, "Login CEO", ["CEO"], { password, clearance: "RESTRICTED" });
    const res = await login(pdb, { email: u.email, password }, { ip: "10.0.0.5" });
    expect(res.mfaRequired).toBe(false);
    expect((await resolveSession(pdb, res.token))?.actor.mfaSatisfied).toBe(true);
  });
  it("a Platform (Super Admin) account's login still forces MFA regardless of MFA_REQUIRED_ROLES", async () => {
    const platformEmail = `platform.login.${Date.now()}@example.test`;
    await pdb.insert(users).values({
      email: platformEmail, fullName: "Platform Login Test", scope: "PLATFORM", companyId: null, status: "ACTIVE",
      passwordHash: await hashPassword(password), passwordChangedAt: new Date(),
    });
    const res = await login(pdb, { email: platformEmail, password }, { ip: "10.0.0.6" });
    expect(res.mfaRequired).toBe(true);
    expect((await resolveSession(pdb, res.token))?.actor.mfaSatisfied).toBe(false);
  });
});

describe("voluntary password change (step-up: current password + fresh TOTP)", () => {
  it("rejects a wrong current password, a bad code and a weak new password; succeeds only with all three right, and revokes other sessions but not this one", async () => {
    const password = "Correct-Horse-Battery-1!";
    const u = await makeUser(db, "Change Password User", ["EMPLOYEE"], { password });
    const secret = newTotpSecret();
    await pdb.update(users).set({ mfaEnabled: true, mfaSecretEnc: encryptSecret(secret) }).where(eq(users.id, u.id));

    const login1 = await login(pdb, { email: u.email, password }, { ip: "10.2.2.1" });
    const login2 = await login(pdb, { email: u.email, password }, { ip: "10.2.2.2" });
    const s1 = (await resolveSession(pdb, login1.token))!;
    const validCode = hotp(secret, stepAt(Date.now()));

    expect(await errCode(changeOwnPassword(pdb, s1.actor, s1.sessionId,
      { currentPassword: "totally-wrong", newPassword: "New-Correct-Password-1!", code: validCode }))).toBe("INVALID_CREDENTIALS");
    expect(await errCode(changeOwnPassword(pdb, s1.actor, s1.sessionId,
      { currentPassword: password, newPassword: "New-Correct-Password-1!", code: "000000" }))).toBe("VALIDATION");
    expect(await errCode(changeOwnPassword(pdb, s1.actor, s1.sessionId,
      { currentPassword: password, newPassword: "short", code: validCode }))).toBe("VALIDATION");

    // None of the failed attempts should have consumed the TOTP step or changed anything.
    await changeOwnPassword(pdb, s1.actor, s1.sessionId, { currentPassword: password, newPassword: "New-Correct-Password-1!", code: validCode });

    expect(await errCode(login(pdb, { email: u.email, password }, { ip: "10.2.2.3" }))).toBe("INVALID_CREDENTIALS");
    expect((await login(pdb, { email: u.email, password: "New-Correct-Password-1!" }, { ip: "10.2.2.4" })).token).toBeTruthy();

    expect(await resolveSession(pdb, login1.token)).not.toBeNull(); // the session that made the change survives
    expect(await resolveSession(pdb, login2.token)).toBeNull();     // every other session is revoked
  });

  it("refuses when two-factor authentication is not set up", async () => {
    const password = "Correct-Horse-Battery-2!";
    const u = await makeUser(db, "No MFA User", ["EMPLOYEE"], { password });
    const res = await login(pdb, { email: u.email, password }, { ip: "10.2.2.5" });
    const s = (await resolveSession(pdb, res.token))!;
    expect(await errCode(changeOwnPassword(pdb, s.actor, s.sessionId,
      { currentPassword: password, newPassword: "New-Correct-Password-2!", code: "123456" }))).toBe("MFA_REQUIRED");
  });
});
