/**
 * DEVELOPMENT/STAGING DEMO DATA ONLY — refuses to run when APP_ENV=production.
 * Creates the demo team, 13 creators and pitches in several stages, including the full
 * "The Last Journey" journey driven through the real workflow engine.
 * Loads into a demo company (code DEMO, domain demo.example.test) — never into a real customer company.
 * Usage: DEMO_USER_PASSWORD='…' npx tsx scripts/seed-demo.ts   (needs DATABASE_URL and PLATFORM_DATABASE_URL)
 */
import { config } from "dotenv";
import { eq, inArray } from "drizzle-orm";
import { createDb, createPool, createTenantDb, withCompany, type Db } from "../src/server/db/client";
import { platforms, users } from "../src/server/db/schema";
import { createActiveUser, ensureCompany } from "../src/server/modules/tenancy/bootstrap";
import { loadActor } from "../src/server/modules/authz/actor";
import { passwordPolicyErrors } from "../src/server/modules/auth/password";

config({ path: ".env.local", quiet: true });
import { createCreator } from "../src/server/modules/creators/service";
import { createPitch } from "../src/server/modules/pitches/service";
import { performAction } from "../src/server/modules/workflow/engine";
import { recordPlatformPitch, recordPlatformResponse } from "../src/server/modules/platforms/service";
import { advanceProduction, greenlight, startDevelopment } from "../src/server/modules/production/service";

if (process.env.APP_ENV === "production" || process.env.NODE_ENV === "production") {
  console.error("Refusing to load demo data into production.");
  process.exit(1);
}

const TEAM: [key: string, name: string, role: string, clearance: "CONFIDENTIAL" | "RESTRICTED"][] = [
  ["employee.a", "Employee A", "EMPLOYEE", "CONFIDENTIAL"], ["employee.b", "Employee B", "EMPLOYEE", "CONFIDENTIAL"],
  ["employee.c", "Employee C", "EMPLOYEE", "CONFIDENTIAL"], ["senior", "Senior Employee", "SENIOR_EMPLOYEE", "CONFIDENTIAL"],
  ["ceo", "CEO", "CEO", "RESTRICTED"], ["coo", "COO", "COO", "RESTRICTED"], ["admin", "Admin", "ADMIN", "CONFIDENTIAL"],
  ["viewer", "Viewer", "VIEWER", "CONFIDENTIAL"],
];

// Fictional demo people. Mobile numbers use the reserved-looking 90000 range and example.test emails.
const CREATORS: [string, "WRITER" | "DIRECTOR" | "WRITER_DIRECTOR"][] = [
  ["Ravi Kumar", "WRITER_DIRECTOR"], ["Anjali Rao", "WRITER"], ["Suresh Varma", "WRITER"], ["Meena Iyer", "WRITER"],
  ["Farhan Qureshi", "WRITER"], ["Lakshmi Prasad", "WRITER"], ["Kiran Reddy", "DIRECTOR"], ["Deepa Nair", "DIRECTOR"],
  ["Arjun Menon", "DIRECTOR"], ["Sana Sheikh", "DIRECTOR"], ["Vikram Shetty", "DIRECTOR"], ["Pooja Hegde Rao", "WRITER_DIRECTOR"],
  ["Naveen Chandra", "WRITER_DIRECTOR"],
];

async function main() {
  const password = process.env.DEMO_USER_PASSWORD ?? "";
  const errs = passwordPolicyErrors(password);
  if (errs.length) throw new Error(`DEMO_USER_PASSWORD rejected: ${errs.join(" ")}`);
  const platform = createDb(process.env.PLATFORM_DATABASE_URL!, 2);
  const appPool = createPool(process.env.DATABASE_URL!, 2);
  const pool = { end: async () => { await platform.pool.end(); await appPool.end(); } };
  try {
    const companyId = await ensureCompany(platform.db, (id) => createTenantDb(appPool, id), { code: "DEMO", name: "Demo Films", domains: ["demo.example.test", "example.test"] });
    const db = createTenantDb(appPool, companyId);
    await withCompany(companyId, async () => {
    const ids: Record<string, string> = {};
    for (const [key, name, role, clearance] of TEAM) {
      const email = `${key}@demo.example.test`;
      const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, email));
      if (existing) { ids[key] = existing.id; continue; }
      ids[key] = await createActiveUser(platform.db, db, { email, fullName: name, roleKeys: [role], clearance, password });
    }
    const actor = async (key: string) => (await loadActor(db, ids[key]!, true))!;

    const creatorIds: string[] = [];
    for (const [i, [fullName, creatorType]] of CREATORS.entries()) {
      try {
        const c = await createCreator(db, await actor("senior"), { creatorType, fullName,
          mobile: `+9190000${String(10000 + i).slice(-5)}`, email: `${fullName.toLowerCase().replace(/\W+/g, ".")}@example.test`,
          languageKeys: ["TELUGU"], consentBasis: "SUBMISSION_AGREEMENT" });
        creatorIds.push(c.id);
      } catch { /* already seeded */ }
    }
    if (creatorIds.length === 0) { console.log("Demo data already present."); return; }
    console.log(`Demo company: DEMO (${companyId}).`);

    const netflix = (await db.select({ id: platforms.id }).from(platforms).where(inArray(platforms.name, ["Netflix"])))[0]!.id;
    await lastJourney(db, creatorIds[0]!, actor, ids, netflix);

    // A handful of pitches parked at different stages for the dashboard.
    const titles = ["Monsoon Letters", "Kaveri Nights", "The Ninth Courtroom", "Signal Lost", "Paper Boats"];
    for (const [i, title] of titles.entries()) {
      const a = await actor("employee.a");
      const p = await createPitch(db, a, { title, formatKey: i % 2 ? "FEATURE_FILM" : "WEB_SERIES", languageKey: "TELUGU", genreKey: "DRAMA", creatorId: creatorIds[i + 1]! });
      let v = p.version;
      const step = async (who: string, body: Record<string, unknown>) => { v = (await performAction(db, await actor(who), p.id, { expectedVersion: v, ...body })).version; };
      if (i >= 1) await step("employee.a", { action: "ASSIGN", recipientId: ids["employee.a"] });
      if (i >= 2) await step("employee.a", { action: "ACCEPT", recipientId: ids["employee.b"], remarks: "Worth a second read." });
      if (i === 3) await step("employee.b", { action: "REJECT", rejectionCategoryKey: "SIMILAR_EXISTING_CONTENT", rejectionReason: "Too close to a title already on our slate." });
      if (i === 4) await step("employee.b", { action: "FORWARD", toStageKey: "EXECUTIVE_REVIEW", recipientId: ids["ceo"], remarks: "Strong commercial hook." });
    }
    console.log("Demo data loaded.");
    });
  } finally {
    await pool.end();
  }
}

async function lastJourney(db: Db, creatorId: string, actor: (k: string) => Promise<Awaited<ReturnType<typeof loadActor>> & object>, ids: Record<string, string>, netflix: string) {
  const p = await createPitch(db, await actor("employee.a"), { title: "The Last Journey", logline: "A retired train driver takes one final, secret route.",
    formatKey: "WEB_SERIES", languageKey: "TELUGU", genreKey: "THRILLER", episodeCount: 8, episodeDurationMin: 40, priority: "HIGH", creatorId });
  let v = p.version;
  const step = async (who: string, body: Record<string, unknown>) => { v = (await performAction(db, await actor(who), p.id, { expectedVersion: v, ...body })).version; };
  await step("employee.a", { action: "ASSIGN", recipientId: ids["employee.a"] });
  await step("employee.a", { action: "ACCEPT", recipientId: ids["employee.b"], remarks: "Strong concept. Recommend forwarding to Employee B.", rating: { overall: 5, scores: [{ categoryKey: "ORIGINALITY", score: 5 }] } });
  await step("employee.b", { action: "REQUEST_CHANGES", remarks: "Episode 3 drags.", changeTypeKeys: ["SCRIPT"] });
  await step("employee.b", { action: "RESUME", remarks: "Script V2 received." });
  await step("employee.b", { action: "FORWARD", toStageKey: "INTERNAL_REVIEW", recipientId: ids["employee.c"], remarks: "Please review V2." });
  await step("employee.c", { action: "FORWARD", toStageKey: "EXECUTIVE_REVIEW", recipientId: ids["coo"], remarks: "Ready for COO." });
  await step("coo", { action: "SEND_TO_PLATFORM", recipientId: ids["senior"], remarks: "Take it to Netflix.", recommendedPlatformIds: [netflix] });
  const pp = await recordPlatformPitch(db, await actor("senior"), p.id, { expectedVersion: v, platformId: netflix, pitchDate: "2026-09-01", methodKey: "EMAIL",
    materialsSent: ["Pitch deck", "Script"], remarks: "Deck and Script V2 sent.", followUpOn: "2026-09-08" });
  v = pp.version;
  await recordPlatformResponse(db, await actor("senior"), pp.platformPitchId, { status: "INTERESTED", responseDate: "2026-09-03" });
  await recordPlatformResponse(db, await actor("senior"), pp.platformPitchId, { status: "SECOND_DRAFT_REQUESTED", responseDate: "2026-09-05", notes: "Asked for a tighter episode 3." });
  v = (await recordPlatformResponse(db, await actor("senior"), pp.platformPitchId, { status: "APPROVED", responseDate: "2026-09-08", notes: "Netflix approved the second draft.", expectedVersion: v })).version!;
  await step("coo", { action: "MARK_READY_FOR_DEVELOPMENT" });
  v = (await startDevelopment(db, await actor("coo"), p.id, { expectedVersion: v, ownerId: ids["senior"]!, startDate: "2026-09-09" })).version;
  v = (await greenlight(db, await actor("ceo"), p.id, { expectedVersion: v, productionOwnerId: ids["senior"]!, remarks: "Greenlit.", productionCompany: "Tamada Media" })).version;
  v = (await advanceProduction(db, await actor("senior"), p.id, { expectedVersion: v })).version;
  await advanceProduction(db, await actor("senior"), p.id, { expectedVersion: v });
}

main().catch((e: unknown) => { console.error(e instanceof Error ? ((e.cause as { message?: string } | undefined)?.message ?? e.message.split("\n")[0]!.slice(0, 200)) : "unknown"); process.exit(1); });
