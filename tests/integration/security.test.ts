/** Abuse cases against the real database with the least-privilege app role. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { auditLogs, pitchParticipants, pitches, sessions, users, workflowEvents } from "@/server/db/schema";
import { login, logout, resolveSession, LOCKOUT_THRESHOLD, SESSION_IDLE_MS } from "@/server/modules/auth/service";
import { canViewPitch, pitchVisibilityCondition } from "@/server/modules/authz/policy";
import { findCreatorMatches, createCreator } from "@/server/modules/creators/service";
import { createPitch } from "@/server/modules/pitches/service";
import { getAvailableActions, getTimeline, performAction } from "@/server/modules/workflow/engine";
import { closeDb, makePitch, makeTeam, makeUser, testDb } from "../helpers/db";

const db = testDb();
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
    expect(emp!.mobileE164).toBe("+91 XXXXX 12345");
    expect(emp!.emailNormalized).toBe("r***@example.com");
    expect(sen!.mobileE164).toBe("+919876512345");
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
    const res = await login(db, { email: u.email.toUpperCase(), password }, { ip: "10.0.0.1" });
    const [s] = await db.select().from(sessions).where(eq(sessions.userId, u.id));
    expect(s!.tokenHash.toString("base64url")).not.toBe(res.token);
    expect((await resolveSession(db, res.token))?.actor.userId).toBe(u.id);
    await logout(db, res.token);
    expect(await resolveSession(db, res.token)).toBeNull();
  });
  it("wrong password and unknown email return the same error", async () => {
    const u = await makeUser(db, "Enum User", ["EMPLOYEE"], { password });
    expect(await errCode(login(db, { email: u.email, password: "Wrong-Password-1!" }, { ip: "10.0.0.2" }))).toBe("INVALID_CREDENTIALS");
    expect(await errCode(login(db, { email: "nobody@example.test", password: "Wrong-Password-1!" }, { ip: "10.0.0.2" }))).toBe("INVALID_CREDENTIALS");
  });
  it(`locks the account after ${LOCKOUT_THRESHOLD} failures, even with the right password`, async () => {
    const u = await makeUser(db, "Lock User", ["EMPLOYEE"], { password });
    for (let i = 0; i < LOCKOUT_THRESHOLD; i++) await errCode(login(db, { email: u.email, password: "Nope-Nope-123!" }, { ip: "10.0.0.3" }));
    expect(await errCode(login(db, { email: u.email, password }, { ip: "10.0.0.3" }))).toBe("ACCOUNT_LOCKED");
  });
  it("rate-limits an IP spraying many accounts", async () => {
    let last = "";
    for (let i = 0; i < 32; i++) last = await errCode(login(db, { email: `spray${i}@example.test`, password: "Spray-Spray-123!" }, { ip: "10.9.9.9" }));
    expect(last).toBe("RATE_LIMITED");
  });
  it("idle sessions expire; disabled users lose access immediately", async () => {
    const u = await makeUser(db, "Idle User", ["EMPLOYEE"], { password });
    const res = await login(db, { email: u.email, password }, { ip: "10.0.0.4" });
    expect(await resolveSession(db, res.token, new Date(Date.now() + SESSION_IDLE_MS + 1000))).toBeNull();
    const res2 = await login(db, { email: u.email, password }, { ip: "10.0.0.4" });
    await db.update(users).set({ status: "DISABLED" }).where(eq(users.id, u.id));
    expect(await resolveSession(db, res2.token)).toBeNull();
  });
  it("CEO login requires MFA before the session is trusted", async () => {
    const u = await makeUser(db, "Login CEO", ["CEO"], { password, clearance: "RESTRICTED" });
    const res = await login(db, { email: u.email, password }, { ip: "10.0.0.5" });
    expect(res.mfaRequired).toBe(true);
    expect((await resolveSession(db, res.token))?.actor.mfaSatisfied).toBe(false);
  });
});
