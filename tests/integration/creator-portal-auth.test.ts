/** Creator portal identity: register, login, session resolution, logout, and cross-tenant/cross-creator isolation. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { creators, creatorSessions } from "@/server/db/schema";
import { loginCreator, logoutCreator, registerCreator, resolveCreatorSession, resolvePortalCompany } from "@/server/modules/creator-portal/auth";
import { closeDb, COMPANY_A, COMPANY_B, creatorTestDb, makePortalLink, testDb } from "../helpers/db";

const errCode = async (p: Promise<unknown>) => { try { await p; return "OK"; } catch (e) { return (e as { code?: string }).code ?? String(e); } };
const errFields = async (p: Promise<unknown>) => { try { await p; return undefined; } catch (e) { return (e as { fields?: Record<string, string> }).fields; } };

let tokenA: string;
let tokenB: string;

beforeAll(async () => {
  tokenA = await makePortalLink(COMPANY_A);
  tokenB = await makePortalLink(COMPANY_B);
});
afterAll(closeDb);

describe("creator portal registration", () => {
  it("resolves a valid token to its company and rejects an unknown one", async () => {
    expect(await resolvePortalCompany(tokenA)).toBe(COMPANY_A);
    expect(await resolvePortalCompany("not-a-real-token")).toBeNull();
  });

  it("registers a new creator against the resolved company and issues a session", async () => {
    const email = `writer.${Date.now()}@example.test`;
    const r = await registerCreator({ token: tokenA, creatorType: "WRITER", fullName: "Asha Rao", email, password: "correct horse battery staple 9" });
    expect(r.companyId).toBe(COMPANY_A);
    const [row] = await testDb(COMPANY_A).select().from(creators).where(eq(creators.id, r.creatorId));
    expect(row?.selfRegistered).toBe(true);
    expect(row?.portalStatus).toBe("ACTIVE");
    expect(row?.emailNormalized).toBe(email.toLowerCase());
    // password_hash must never be a session-readable artifact of the registration response
    expect((r as unknown as Record<string, unknown>).passwordHash).toBeUndefined();

    const session = await resolveCreatorSession(COMPANY_A, r.token);
    expect(session?.creatorId).toBe(r.creatorId);
    // Registration collects everything the handoff calls "profile" (creator type, name, mobile) in one
    // step — there is no separate profile-completion step, so this is true immediately.
    expect(session?.profileCompleted).toBe(true);
  });

  it("rejects an unknown/disabled link token", async () => {
    expect(await errCode(registerCreator({ token: "bogus-token-value", creatorType: "WRITER", fullName: "Nobody", email: `x.${Date.now()}@example.test`, password: "correct horse battery staple 9" })))
      .toBe("NOT_FOUND");
  });

  it("rejects a duplicate email within the same company", async () => {
    const email = `dup.${Date.now()}@example.test`;
    await registerCreator({ token: tokenA, creatorType: "WRITER", fullName: "First", email, password: "correct horse battery staple 9" });
    const dup = registerCreator({ token: tokenA, creatorType: "WRITER", fullName: "Second", email, password: "correct horse battery staple 9" });
    expect(await errCode(dup)).toBe("CONFLICT");
    // The conflict is genuinely the email — must not be mislabeled as a mobile-number conflict below.
    expect(await errFields(registerCreator({ token: tokenA, creatorType: "WRITER", fullName: "Third", email, password: "correct horse battery staple 9" }))).toEqual({ email: "Already registered" });
  });

  it("rejects a duplicate mobile number within the same company, distinct from an email conflict", async () => {
    // creators has two separate unique indexes (email, mobile) — a real bug here reported every 23505 as
    // an email conflict regardless of which index actually fired, which is exactly what this test guards.
    const mobile = `+9198765${Date.now() % 100000}`;
    await registerCreator({ token: tokenA, creatorType: "WRITER", fullName: "Mobile First", mobile, email: `mob1.${Date.now()}@example.test`, password: "correct horse battery staple 9" });
    const dup = registerCreator({ token: tokenA, creatorType: "WRITER", fullName: "Mobile Second", mobile, email: `mob2.${Date.now()}@example.test`, password: "correct horse battery staple 9" });
    expect(await errCode(dup)).toBe("CONFLICT");
    expect(await errFields(registerCreator({ token: tokenA, creatorType: "WRITER", fullName: "Mobile Third", mobile, email: `mob3.${Date.now()}@example.test`, password: "correct horse battery staple 9" })))
      .toEqual({ mobile: "Already registered" });
  });

  it("allows the SAME email to register independently in a different company (company-scoped identity)", async () => {
    const email = `shared.${Date.now()}@example.test`;
    const a = await registerCreator({ token: tokenA, creatorType: "WRITER", fullName: "Same Email A", email, password: "correct horse battery staple 9" });
    const b = await registerCreator({ token: tokenB, creatorType: "WRITER", fullName: "Same Email B", email, password: "correct horse battery staple 9" });
    expect(a.creatorId).not.toBe(b.creatorId);
    expect(a.companyId).toBe(COMPANY_A);
    expect(b.companyId).toBe(COMPANY_B);
  });

  it("rejects a weak password", async () => {
    expect(await errCode(registerCreator({ token: tokenA, creatorType: "WRITER", fullName: "Weak Pw", email: `weak.${Date.now()}@example.test`, password: "abc" }))).toBe("VALIDATION");
  });
});

describe("creator portal login", () => {
  it("logs in with the right token/email/password and rejects the wrong password", async () => {
    const email = `login.${Date.now()}@example.test`;
    const password = "correct horse battery staple 9";
    await registerCreator({ token: tokenA, creatorType: "WRITER", fullName: "Login Test", email, password });
    const ok = await loginCreator({ token: tokenA, email, password });
    expect(ok.companyId).toBe(COMPANY_A);
    expect(await errCode(loginCreator({ token: tokenA, email, password: "wrong-password-entirely-1" }))).toBe("INVALID_CREDENTIALS");
  });

  it("the SAME email+password fails against the WRONG company's link (identity is company-scoped, not global)", async () => {
    const email = `scoped.${Date.now()}@example.test`;
    const password = "correct horse battery staple 9";
    await registerCreator({ token: tokenA, creatorType: "WRITER", fullName: "Scoped", email, password });
    expect(await errCode(loginCreator({ token: tokenB, email, password }))).toBe("INVALID_CREDENTIALS");
  });

  it("locks the account after repeated failures", async () => {
    const email = `lockout.${Date.now()}@example.test`;
    const password = "correct horse battery staple 9";
    await registerCreator({ token: tokenA, creatorType: "WRITER", fullName: "Lockout", email, password });
    for (let i = 0; i < 5; i++) await errCode(loginCreator({ token: tokenA, email, password: "wrong-one-here-1" }));
    expect(await errCode(loginCreator({ token: tokenA, email, password }))).toBe("ACCOUNT_LOCKED");
  });

  it("a disabled (portal_status = DISABLED) creator cannot log in even with the right password", async () => {
    const email = `disabled.${Date.now()}@example.test`;
    const password = "correct horse battery staple 9";
    const r = await registerCreator({ token: tokenA, creatorType: "WRITER", fullName: "Disabled", email, password });
    await testDb(COMPANY_A).update(creators).set({ portalStatus: "DISABLED" }).where(eq(creators.id, r.creatorId));
    expect(await errCode(loginCreator({ token: tokenA, email, password }))).toBe("ACCOUNT_LOCKED");
    expect(await resolveCreatorSession(COMPANY_A, r.token)).toBeNull(); // an existing session must also stop working
  });
});

describe("creator portal session isolation", () => {
  it("logout revokes the session; the same token no longer resolves", async () => {
    const email = `logout.${Date.now()}@example.test`;
    const r = await registerCreator({ token: tokenA, creatorType: "WRITER", fullName: "Logout Test", email, password: "correct horse battery staple 9" });
    expect(await resolveCreatorSession(COMPANY_A, r.token)).not.toBeNull();
    await logoutCreator(COMPANY_A, r.creatorId, r.token);
    expect(await resolveCreatorSession(COMPANY_A, r.token)).toBeNull();
  });

  it("a session token issued for company A resolves to nothing when looked up under company B's context", async () => {
    const email = `crosscompany.${Date.now()}@example.test`;
    const r = await registerCreator({ token: tokenA, creatorType: "WRITER", fullName: "Cross Company", email, password: "correct horse battery staple 9" });
    expect(await resolveCreatorSession(COMPANY_B, r.token)).toBeNull();
  });

  it("a creator's raw pitch_creator connection sees no session rows without its own session context set", async () => {
    const email = `noctx.${Date.now()}@example.test`;
    const r = await registerCreator({ token: tokenA, creatorType: "WRITER", fullName: "No Context", email, password: "correct horse battery staple 9" });
    const other = creatorTestDb(COMPANY_A, "00000000-0000-4000-8000-000000000000"); // a random, non-existent creator id in the same company
    const rows = await other.select().from(creatorSessions);
    expect(rows.find((row) => row.creatorId === r.creatorId)).toBeUndefined();
  });
});
