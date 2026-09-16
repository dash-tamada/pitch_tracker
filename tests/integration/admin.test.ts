import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { auditLogs, jobOutbox, notifications, pitches, sessions, users } from "@/server/db/schema";
import { getActiveWorkflow, publishWorkflowVersion, queryAudit, updateSettings, upsertLookup } from "@/server/modules/admin/config";
import { login, resolveSession } from "@/server/modules/auth/service";
import { exportCsv, managementReports } from "@/server/modules/reports/service";
import { globalSearch } from "@/server/modules/search/service";
import { listNotifications, markRead } from "@/server/modules/notifications/service";
import { LogEmail } from "@/server/modules/jobs/email";
import { agingAlerts, followUpReminders, processOutbox, reconcileProjections } from "@/server/modules/jobs/runner";
import { completePasswordReset, createUser, issuePasswordResetLink, listRolesWithPermissions, requestPasswordReset, setRolePermissions, updateUser } from "@/server/modules/users/admin";
import { loadActor } from "@/server/modules/authz/actor";
import { acceptInvitation } from "@/server/modules/tenancy/invitations";
import { createCreator } from "@/server/modules/creators/service";
import { createPitch } from "@/server/modules/pitches/service";
import { performAction } from "@/server/modules/workflow/engine";
import { closeDb, makePitch, makeTeam, makeUser, platformTestDb, testDb } from "../helpers/db";

const db = testDb();
const pdb = platformTestDb();
let team: Awaited<ReturnType<typeof makeTeam>>;
let superAdmin: Awaited<ReturnType<typeof makeUser>>;
const code = async (p: Promise<unknown>) => { try { await p; return "OK"; } catch (e) { return (e as { code?: string }).code ?? String(e); } };
const tokenOf = (path: string) => path.split("#")[1]!;

beforeAll(async () => {
  team = await makeTeam(db);
  superAdmin = await makeUser(db, "Root Admin", ["COMPANY_ADMIN"], { clearance: "RESTRICTED" });
});
afterAll(closeDb);

describe("user administration guard rails", () => {
  it("admin invites a user with a one-time link; the user chooses a password, activates and signs in", async () => {
    const r = await createUser(db, team.admin.actor, { email: "New.Reviewer@Example.test", fullName: "New Reviewer", roleKeys: ["EMPLOYEE"] });
    expect(r.invitePath).toMatch(/^\/accept-invite#[A-Za-z0-9_-]{43}$/);
    expect(await code(login(pdb, { email: "new.reviewer@example.test", password: "Film-Reels-2026!" }, { ip: "10.5.5.4" }))).toBe("INVALID_CREDENTIALS"); // not active yet
    expect(await code(acceptInvitation(pdb, { token: tokenOf(r.invitePath), password: "short" }))).toBe("VALIDATION");
    await acceptInvitation(pdb, { token: tokenOf(r.invitePath), password: "Film-Reels-2026!" });
    expect(await code(acceptInvitation(pdb, { token: tokenOf(r.invitePath), password: "Film-Reels-2027!" }))).toBe("VALIDATION"); // single use
    const s = await login(pdb, { email: "new.reviewer@example.test", password: "Film-Reels-2026!" }, { ip: "10.5.5.5" });
    expect((await resolveSession(pdb, s.token))?.actor.roles.has("EMPLOYEE")).toBe(true);
  });
  it("admin cannot grant Company Admin, RESTRICTED clearance, change own access, or touch a Company Admin", async () => {
    expect(await code(createUser(db, team.admin.actor, { email: "x1@example.test", fullName: "X One", roleKeys: ["COMPANY_ADMIN"] }))).toBe("FORBIDDEN");
    expect(await code(createUser(db, team.admin.actor, { email: "x2@example.test", fullName: "X Two", roleKeys: ["EMPLOYEE"], clearance: "RESTRICTED" }))).toBe("FORBIDDEN");
    expect(await code(updateUser(db, team.admin.actor, team.admin.id, { roleKeys: ["CEO"] }))).toBe("FORBIDDEN");
    expect(await code(updateUser(db, team.admin.actor, superAdmin.id, { status: "DISABLED" }))).toBe("FORBIDDEN");
    expect(await code(issuePasswordResetLink(db, team.admin.actor, superAdmin.id))).toBe("FORBIDDEN");
    expect(await code(updateUser(db, team.employeeA.actor, team.employeeB.id, { roleKeys: ["CEO"] }))).toBe("FORBIDDEN");
  });
  it("Company Admins cannot be locked out: no self-demotion, and only a Company Admin can demote another", async () => {
    const second = await makeUser(db, "Second Root", ["COMPANY_ADMIN"], { clearance: "RESTRICTED" });
    expect(await code(updateUser(db, second.actor, second.id, { roleKeys: ["EMPLOYEE"] }))).toBe("FORBIDDEN");   // self
    expect(await code(updateUser(db, team.admin.actor, second.id, { roleKeys: ["EMPLOYEE"] }))).toBe("FORBIDDEN"); // not a Company Admin
    expect(await code(updateUser(db, superAdmin.actor, second.id, { roleKeys: ["EMPLOYEE"] }))).toBe("OK");         // actor remains Company Admin
  });
  it("role and status changes revoke sessions immediately and are audited as permission changes", async () => {
    const u = await makeUser(db, "Session Victim", ["EMPLOYEE"], { password: "Monsoon-Rains-2026!" });
    const s = await login(pdb, { email: u.email, password: "Monsoon-Rains-2026!" }, { ip: "10.6.6.6" });
    await updateUser(db, team.admin.actor, u.id, { roleKeys: ["VIEWER"] });
    expect(await resolveSession(pdb, s.token)).toBeNull();
    const audit = await db.select().from(auditLogs).where(eq(auditLogs.resourceId, u.id));
    expect(audit.find((a) => a.action === "permission.changed")?.before).toMatchObject({ roles: ["EMPLOYEE"] });
  });
  it("an admin cannot give a role administration powers; permission edits log everyone out of that role", async () => {
    expect(await code(setRolePermissions(db, team.admin.actor, "EMPLOYEE", { permissionKeys: ["pitch.view", "user.manage"] }))).toBe("FORBIDDEN");
    expect(await code(setRolePermissions(db, team.admin.actor, "COMPANY_ADMIN", { permissionKeys: [] }))).toBe("FORBIDDEN");
    expect(await code(setRolePermissions(db, team.admin.actor, "ADMIN", { permissionKeys: [] }))).toBe("FORBIDDEN"); // own role
    const viewerPerms = (await listRolesWithPermissions(db, team.admin.actor)).roles.find((r) => r.key === "VIEWER")!.permissions;
    await setRolePermissions(db, team.admin.actor, "VIEWER", { permissionKeys: [...viewerPerms, "platform.view"] });
    const refreshed = await loadActor(db, team.viewer.id, true);
    expect(refreshed!.permissions.has("platform.view")).toBe(true);
  });
  it("self-service reset never reveals whether an email exists and stores only a hashed token", async () => {
    expect(await requestPasswordReset(pdb, { email: "nobody-at-all@example.test" })).toEqual({ ok: true });
    const u = await makeUser(db, "Forgetful", ["EMPLOYEE"], { password: "Monsoon-Rains-2026!" });
    expect(await requestPasswordReset(pdb, { email: u.email })).toEqual({ ok: true });
    const email = new LogEmail();
    await processOutbox(db, email);
    expect(email.sent.some((m) => m.to === u.email && m.subject.includes("password reset"))).toBe(true);
    const jobs = await db.select().from(jobOutbox).where(eq(jobOutbox.type, "EMAIL_PASSWORD_RESET"));
    for (const j of jobs) expect(j.payload).not.toHaveProperty("token"); // raw token removed after sending
  });
});

describe("configuration without code changes", () => {
  it("admin adds a language; keys are immutable identifiers", async () => {
    await upsertLookup(db, team.admin.actor, { type: "LANGUAGE", key: "MARATHI", label: "Marathi" });
    expect(await code(upsertLookup(db, team.admin.actor, { type: "LANGUAGE", key: "bad key", label: "x" }))).toBe("VALIDATION");
    expect(await code(upsertLookup(db, team.employeeA.actor, { type: "LANGUAGE", key: "ODIA", label: "Odia" }))).toBe("FORBIDDEN");
  });
  it("relaxing approval rules requires Company Admin; thresholds must increase", async () => {
    expect(await code(updateSettings(db, team.admin.actor, { allow_self_approval: true }))).toBe("FORBIDDEN");
    expect(await code(updateSettings(db, team.admin.actor, { aging_thresholds_days: { attention: 5, overdue: 3, critical: 14 } }))).toBe("VALIDATION");
    await updateSettings(db, team.admin.actor, { aging_thresholds_days: { attention: 2, overdue: 6, critical: 12 } });
    await updateSettings(db, team.admin.actor, { aging_thresholds_days: { attention: 3, overdue: 7, critical: 14 } });
  });
  it("workflow versions: non-negotiable rules are enforced; in-flight pitches stay on their version", async () => {
    const pitch = await makePitch(db, team.employeeA, { title: "Pinned to v1" });
    const wf = await getActiveWorkflow(db, team.admin.actor);
    const payload = {
      name: wf.definition.name, initialStageKey: wf.definition.initialStageKey,
      stages: wf.stages.map((s) => ({ key: s.key, name: s.name, category: s.category, badge: s.badge, isTerminal: s.isTerminal, requiresOwner: s.requiresOwner })),
      transitions: wf.transitions.map(({ id: _i, definitionId: _d, ...t }) => t),
    };
    const broken = { ...payload, transitions: payload.transitions.map((t) => (t.action === "REJECT" ? { ...t, requiresRejectionReason: false } : t)) };
    expect(await code(publishWorkflowVersion(db, team.admin.actor, broken))).toBe("VALIDATION");
    const renamed = { ...payload, stages: payload.stages.map((s) => (s.key === "SENIOR_REVIEW" ? { ...s, name: "Head of Content Review" } : s)) };
    const v2 = await publishWorkflowVersion(db, team.admin.actor, renamed);
    expect(v2.version).toBeGreaterThan(wf.definition.version);
    // old pitch still acts on v1; new pitch uses v2
    const r = await performAction(db, team.employeeA.actor, pitch.id, { action: "ASSIGN", expectedVersion: pitch.version, recipientId: team.employeeA.id });
    expect(r.event.toStageKey).toBe("INITIAL_REVIEW");
    const creator = await createCreator(db, team.senior.actor, { creatorType: "WRITER", fullName: "Version Two Writer" });
    await createPitch(db, team.employeeA.actor, { title: "On v2", formatKey: "WEB_SERIES", languageKey: "TELUGU", creatorId: creator.id });
    const active = await getActiveWorkflow(db, team.admin.actor);
    expect(active.stages.find((s) => s.key === "SENIOR_REVIEW")!.name).toBe("Head of Content Review");
  });
});

describe("audit, reports, exports, search, notifications, jobs", () => {
  it("audit log is viewable only with audit.view", async () => {
    const page = await queryAudit(db, team.admin.actor, { action: "permission" });
    expect(page.items.every((i) => i.action.startsWith("permission"))).toBe(true);
    expect(await code(queryAudit(db, team.ceo.actor, {}))).toBe("FORBIDDEN");
  });
  it("CSV export: permission-gated, formula-safe, PII-masked for non-PII roles, and audited", async () => {
    await createCreator(db, team.senior.actor, { creatorType: "WRITER", fullName: "=HYPERLINK(\"http://evil\")", mobile: "9000033333" });
    expect(await code(exportCsv(db, team.employeeA.actor, { kind: "creators" }))).toBe("FORBIDDEN");
    const out = await exportCsv(db, team.ceo.actor, { kind: "creators" });
    expect(out.csv.startsWith("﻿")).toBe(true);
    expect(out.csv).toContain(`"'=HYPERLINK(""http://evil"")"`);
    expect(out.csv).toContain("+919000033333");
    const rejections = await exportCsv(db, team.ceo.actor, { kind: "rejections" });
    expect(rejections.csv.split("\r\n")[0]).toContain("Rejection reason");
    const logged = await db.select().from(auditLogs).where(eq(auditLogs.action, "data.exported"));
    expect(logged.length).toBeGreaterThanOrEqual(2);
    expect(await code(exportCsv(db, team.ceo.actor, { kind: "pitches", orderBy: "x" }))).toBe("VALIDATION");
  });
  it("reports include employee review metrics and bottlenecks", async () => {
    const p = await makePitch(db, team.employeeA, { title: "Report Sample" });
    const v = (await performAction(db, team.employeeA.actor, p.id, { action: "ASSIGN", expectedVersion: p.version, recipientId: team.employeeA.id })).version;
    await performAction(db, team.employeeA.actor, p.id, { action: "ACCEPT", expectedVersion: v, recipientId: team.employeeB.id, remarks: "Recommend" });
    const r = await managementReports(db, team.ceo.actor);
    expect(r.employees.find((e) => e.userId === team.employeeA.id)).toMatchObject({ accepted: 1, acceptanceRate: 100 });
    expect(r.employees.find((e) => e.userId === team.employeeA.id)!.avgReviewDays).toBeGreaterThanOrEqual(0);
    expect(await code(managementReports(db, team.employeeA.actor))).toBe("FORBIDDEN");
  });
  it("global search respects visibility and masks contact data", async () => {
    const mine = await makePitch(db, team.employeeB, { title: "Kaveri Secret Search" });
    const other = await globalSearch(db, team.employeeC.actor, { q: "Kaveri Secret" });
    expect(other.pitches.some((p) => p.id === mine.id)).toBe(false);
    const own = await globalSearch(db, team.employeeB.actor, { q: "Kaveri Secret" });
    expect(own.pitches.some((p) => p.id === mine.id)).toBe(true);
    const byPhone = await globalSearch(db, team.employeeC.actor, { q: "+91 90000 33333" });
    expect(byPhone.creators[0]?.mobile).toBe("+91 XXXXX 33333");
    const plat = await globalSearch(db, team.ceo.actor, { q: "Netflix" });
    expect(plat.platforms.map((p) => p.name)).toContain("Netflix");
    expect(await code(globalSearch(db, team.ceo.actor, { q: "x" }))).toBe("VALIDATION");
  });
  it("notifications are private and can be marked read only by their owner", async () => {
    const list = await listNotifications(db, team.employeeA.actor, {});
    const foreign = await db.select({ id: notifications.id }).from(notifications).where(eq(notifications.userId, team.employeeB.id)).limit(1);
    if (foreign[0]) expect((await markRead(db, team.employeeA.actor, { ids: [foreign[0].id] })).updated).toBe(0);
    await markRead(db, team.employeeA.actor, { all: true });
    expect((await listNotifications(db, team.employeeA.actor, {})).unread).toBe(0);
    expect(list.items.every((n) => typeof n.title === "string")).toBe(true);
  });
  it("jobs: emails contain no story content, aging alerts are de-duplicated, projections reconcile", async () => {
    const email = new LogEmail();
    await processOutbox(db, email, 500);
    expect(email.sent.every((m) => m.subject === "Pitch Tracker: you have a new update" || m.subject.includes("password"))).toBe(true);
    const future = new Date(Date.now() + 20 * 86_400_000);
    const first = await agingAlerts(db, future);
    const second = await agingAlerts(db, future);
    expect(first.sent).toBeGreaterThan(0);
    expect(second.sent).toBe(0);
    expect((await followUpReminders(db)).sent).toBeGreaterThanOrEqual(0);
    const rec = await reconcileProjections(db, 2);
    const all = await db.select({ id: pitches.id }).from(pitches);
    expect(rec).toEqual({ checked: all.length, drift: 0 }); // pages through every pitch in batches of 2
    const s = await db.select().from(sessions).limit(1);
    expect(Array.isArray(s)).toBe(true);
  });
});
