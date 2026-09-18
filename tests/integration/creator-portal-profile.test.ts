/**
 * Creator portal profile: setup/edit round-trip, profileCompletedAt set-once semantics, IMDB/Wikipedia-style
 * links, mobile/email conflict disambiguation, cross-creator/cross-company project isolation, and
 * self-service password change (including other-session revocation).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loginCreator, registerCreator, resolveCreatorSession } from "@/server/modules/creator-portal/auth";
import { addMyProject, changeMyPassword, getMyProfile, listMyProjects, updateMyProfile, updateMyProject } from "@/server/modules/creator-portal/profile";
import { closeDb, COMPANY_A, COMPANY_B, makePortalLink } from "../helpers/db";

const errCode = async (p: Promise<unknown>) => { try { await p; return "OK"; } catch (e) { return (e as { code?: string }).code ?? String(e); } };
const errFields = async (p: Promise<unknown>) => { try { await p; return undefined; } catch (e) { return (e as { fields?: Record<string, string> }).fields; } };

let tokenA: string;
let tokenB: string;

beforeAll(async () => {
  tokenA = await makePortalLink(COMPANY_A);
  tokenB = await makePortalLink(COMPANY_B);
});
afterAll(closeDb);

async function newCreator(token: string, name: string) {
  return registerCreator({ token, creatorType: "WRITER", fullName: name, email: `${name.toLowerCase().replace(/\s+/g, ".")}.${Date.now()}.${Math.random().toString(36).slice(2)}@example.test`, password: "correct horse battery staple 9" });
}

describe("creator portal profile setup/edit", () => {
  it("starts incomplete after registration; the first save completes it regardless of which optional fields were filled", async () => {
    const c = await newCreator(tokenA, "Profile One");
    const before = await getMyProfile(c.companyId, c.creatorId);
    // Registration is identity only — this is what auth.ts's own registration test also asserts;
    // repeated here because it is the precondition every other assertion in this file depends on.
    expect(before.profile.profileCompleted).toBe(false);
    expect(before.profile.location).toBeNull();

    const r = await updateMyProfile(c.companyId, c.creatorId, { location: "Hyderabad", bio: "Writer of thrillers." });
    expect(r.profileCompleted).toBe(true);

    const after = await getMyProfile(c.companyId, c.creatorId);
    expect(after.profile.profileCompleted).toBe(true);
    expect(after.profile.location).toBe("Hyderabad");
    expect(after.profile.bio).toBe("Writer of thrillers.");
  });

  it("keeps profileCompleted true after it is set — a later edit never resets or re-derives it", async () => {
    const c = await newCreator(tokenA, "Profile Two");
    await updateMyProfile(c.companyId, c.creatorId, { location: "Chennai" });
    const r2 = await updateMyProfile(c.companyId, c.creatorId, { location: "Mumbai" });
    expect(r2.profileCompleted).toBe(true);
    const after = await getMyProfile(c.companyId, c.creatorId);
    expect(after.profile.location).toBe("Mumbai");
  });

  it("stores IMDB/Wikipedia/other links as the same generic label+url pairs the staff form uses", async () => {
    const c = await newCreator(tokenA, "Profile Links");
    await updateMyProfile(c.companyId, c.creatorId, {
      socialLinks: [{ label: "IMDB", url: "https://www.imdb.com/name/nm0000001/" }, { label: "Wikipedia", url: "https://en.wikipedia.org/wiki/Example" }],
    });
    const after = await getMyProfile(c.companyId, c.creatorId);
    expect(after.profile.socialLinks).toEqual([
      { label: "IMDB", url: "https://www.imdb.com/name/nm0000001/" },
      { label: "Wikipedia", url: "https://en.wikipedia.org/wiki/Example" },
    ]);
  });

  it("rejects a profile update that collides with another creator's mobile number, distinct from an email collision", async () => {
    const mobile = `+9198766${Date.now() % 100000}`;
    const holder = await newCreator(tokenA, "Taken Mobile");
    await updateMyProfile(holder.companyId, holder.creatorId, { mobile });
    const wants = await newCreator(tokenA, "Wants Mobile");
    expect(await errFields(updateMyProfile(wants.companyId, wants.creatorId, { mobile }))).toEqual({ mobile: "Already registered" });

    const email = `taken.${Date.now()}@example.test`;
    const holder2 = await newCreator(tokenA, "Taken Email");
    await updateMyProfile(holder2.companyId, holder2.creatorId, { email });
    const wants2 = await newCreator(tokenA, "Wants Email");
    expect(await errFields(updateMyProfile(wants2.companyId, wants2.creatorId, { email }))).toEqual({ email: "Already registered" });
  });

  it("never clears email — creators_portal_identity_ck requires a self-registered creator to always have one", async () => {
    const c = await newCreator(tokenA, "Keeps Email");
    const before = await getMyProfile(c.companyId, c.creatorId);
    await updateMyProfile(c.companyId, c.creatorId, { location: "Pune" }); // email omitted, not cleared
    const after = await getMyProfile(c.companyId, c.creatorId);
    expect(after.profile.email).toBe(before.profile.email);
  });
});

describe("creator portal projects", () => {
  it("adds, lists, and archives (removes) a project on the caller's own profile", async () => {
    const c = await newCreator(tokenA, "Project Owner");
    const added = await addMyProject(c.companyId, c.creatorId, { projectName: "Monsoon Diaries", role: "WRITER" });
    let list = await listMyProjects(c.companyId, c.creatorId);
    expect(list.map((p) => p.id)).toContain(added.id);
    await updateMyProject(c.companyId, c.creatorId, added.id, { archived: true });
    list = await listMyProjects(c.companyId, c.creatorId);
    expect(list.map((p) => p.id)).not.toContain(added.id);
  });

  it("a project on one creator's profile is invisible and unreachable to another creator in the SAME company", async () => {
    const owner = await newCreator(tokenA, "Project Owner Two");
    const stranger = await newCreator(tokenA, "Project Stranger");
    const added = await addMyProject(owner.companyId, owner.creatorId, { projectName: "Secret Screenplay", role: "WRITER" });
    const strangerList = await listMyProjects(stranger.companyId, stranger.creatorId);
    expect(strangerList.map((p) => p.id)).not.toContain(added.id);
    // creator_own_projects RLS means a stranger's project and a made-up id look identical — no existence oracle.
    expect(await errCode(updateMyProject(stranger.companyId, stranger.creatorId, added.id, { projectName: "Hijacked" }))).toBe("NOT_FOUND");
  });

  it("a project is also unreachable across companies", async () => {
    const ownerA = await newCreator(tokenA, "Cross Company Owner");
    const creatorB = await newCreator(tokenB, "Cross Company Stranger");
    const added = await addMyProject(ownerA.companyId, ownerA.creatorId, { projectName: "Company A Only", role: "DIRECTOR" });
    expect(await errCode(updateMyProject(creatorB.companyId, creatorB.creatorId, added.id, { archived: true }))).toBe("NOT_FOUND");
  });
});

describe("creator portal password change", () => {
  it("changes the password, revokes every OTHER session, and lets the new password sign in afterward", async () => {
    const email = `pwchange.${Date.now()}@example.test`;
    const password = "correct horse battery staple 9";
    const reg = await registerCreator({ token: tokenA, creatorType: "WRITER", fullName: "Password Change", email, password });
    const login2 = await loginCreator({ token: tokenA, email, password }); // a second, separate session
    const currentSession = await resolveCreatorSession(reg.companyId, reg.token);

    const newPassword = "another correct horse battery 7";
    const r = await changeMyPassword(reg.companyId, reg.creatorId, currentSession!.sessionId, { currentPassword: password, newPassword });
    expect(r.ok).toBe(true);

    // The session the change was made FROM stays valid...
    expect(await resolveCreatorSession(reg.companyId, reg.token)).not.toBeNull();
    // ...but every OTHER session is revoked.
    expect(await resolveCreatorSession(reg.companyId, login2.token)).toBeNull();

    expect(await errCode(loginCreator({ token: tokenA, email, password }))).toBe("INVALID_CREDENTIALS");
    const relogin = await loginCreator({ token: tokenA, email, password: newPassword });
    expect(relogin.creatorId).toBe(reg.creatorId);
  });

  it("rejects the wrong current password and a reused new password", async () => {
    const email = `pwwrong.${Date.now()}@example.test`;
    const password = "correct horse battery staple 9";
    const reg = await registerCreator({ token: tokenA, creatorType: "WRITER", fullName: "Password Wrong", email, password });
    const session = await resolveCreatorSession(reg.companyId, reg.token);
    expect(await errCode(changeMyPassword(reg.companyId, reg.creatorId, session!.sessionId, { currentPassword: "not-the-password-1", newPassword: "some other password 4" })))
      .toBe("INVALID_CREDENTIALS");
    expect(await errCode(changeMyPassword(reg.companyId, reg.creatorId, session!.sessionId, { currentPassword: password, newPassword: password })))
      .toBe("VALIDATION");
  });
});
