/**
 * DEVELOPMENT/STAGING DEMO DATA ONLY — refuses to run when APP_ENV=production.
 * Creates the demo team, 13 creators and pitches in several stages, including the full
 * "The Last Journey" journey driven through the real workflow engine.
 * Usage: DEMO_USER_PASSWORD='…' npx tsx scripts/seed-demo.ts
 */
import { eq, inArray } from "drizzle-orm";
import { createDb, type Db } from "../src/server/db/client";
import { platforms, roles, userRoles, users } from "../src/server/db/schema";
import { loadActor } from "../src/server/modules/authz/actor";
import { hashPassword, passwordPolicyErrors } from "../src/server/modules/auth/password";
import { createCreator } from "../src/server/modules/creators/service";
import { createPitch } from "../src/server/modules/pitches/service";
import { performAction } from "../src/server/modules/workflow/engine";

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
  const { db, pool } = createDb(process.env.DATABASE_URL!, 2);
  try {
    const ids: Record<string, string> = {};
    const hash = await hashPassword(password);
    for (const [key, name, role, clearance] of TEAM) {
      const email = `${key}@demo.example.test`;
      const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, email));
      if (existing) { ids[key] = existing.id; continue; }
      const [u] = await db.insert(users).values({ email, fullName: name, passwordHash: hash, clearance }).returning({ id: users.id });
      const [r] = await db.select({ id: roles.id }).from(roles).where(eq(roles.key, role));
      await db.insert(userRoles).values({ userId: u!.id, roleId: r!.id });
      ids[key] = u!.id;
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
  await step("senior", { action: "RECORD_PLATFORM_PITCH", platformId: netflix, remarks: "Deck and Script V2 sent." });
  await step("senior", { action: "MARK_PLATFORM_APPROVED", platformId: netflix, remarks: "Netflix approved the second draft." });
  await step("coo", { action: "MARK_READY_FOR_DEVELOPMENT" });
  await step("coo", { action: "START_DEVELOPMENT", recipientId: ids["senior"] });
  await step("ceo", { action: "GREENLIGHT", recipientId: ids["senior"], remarks: "Greenlit." });
  await step("senior", { action: "ADVANCE" });
  await step("senior", { action: "ADVANCE" });
}

main().catch((e: unknown) => { console.error(e instanceof Error ? ((e.cause as { message?: string } | undefined)?.message ?? e.message.split("\n")[0]!.slice(0, 200)) : "unknown"); process.exit(1); });
