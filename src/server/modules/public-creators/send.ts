/**
 * Sending a platform-wide creator's pitch to production houses (companies) — as many as they like, any time.
 *
 * Everything inside the company runs on the same restricted creator role, through the same row-level-security policies,
 * the company's own creator portal uses (creatorDb) — a company never trusts anything a creator controls beyond what
 * that role is already allowed to write. The creator's company record carries no email or password (it is linked to the
 * platform-wide creator by public_creator_id) and its id is derived from (company, creator), so a person never gets two
 * records in one company.
 *
 * The pitch stays the writer's own and editable: each send COPIES the files into that company's storage area (public_draft_sends
 * records the send, public_send_documents records which file went where). A file added after pitching is delivered to every
 * house that already has the pitch, exactly once.
 *
 * Not one transaction (company data and platform-wide data live behind different database roles), so the steps are ordered
 * to fail safely: the send row is only written once the company's pitch exists.
 */
import { createHash, randomUUID } from "node:crypto";
import { and, asc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { creatorDb } from "@/server/db/client";
import type { Db } from "@/server/db/client";
import {
  companies, creators, documents, documentVersions, lookupValues, publicCreatorCredits, publicCreators, publicDraftFiles, publicDraftSends,
  publicDrafts, publicSendDocuments,
} from "@/server/db/schema";
import { AppError, notFound } from "@/server/lib/errors";
import { normalizeName } from "@/server/lib/pii";
import { parseInput } from "@/server/lib/validation";
import { writeAudit, type RequestContext } from "@/server/modules/audit/service";
import { pgCode, pgConstraint } from "@/server/modules/creator-portal/auth";
import { submitCreatorPitch } from "@/server/modules/creator-portal/pitch";
import type { StoragePort } from "@/server/modules/storage/port";

const sendSchema = z.object({ companyIds: z.array(z.uuid()).min(1).max(10) }).strict();

/** A stable UUID (RFC 4122 v5 style) for "this platform-wide creator, inside this company". */
export function companyCreatorId(companyId: string, publicCreatorId: string): string {
  const h = createHash("sha1").update(`public-creator:${companyId}:${publicCreatorId}`).digest();
  h[6] = (h[6]! & 0x0f) | 0x50;
  h[8] = (h[8]! & 0x3f) | 0x80;
  const x = h.subarray(0, 16).toString("hex");
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20, 32)}`;
}

/** Postgres RAISE EXCEPTION text from the portal's own gate functions → something a creator can act on. */
function friendly(e: unknown): AppError | null {
  const msg = (e as { message?: string; cause?: { message?: string } })?.cause?.message ?? (e as { message?: string })?.message ?? "";
  if (msg.includes("plan limit reached")) return new AppError("PLAN_LIMIT", "This production house cannot accept more pitches right now.");
  if (msg.includes("subscription not active")) return new AppError("COMPANY_UNAVAILABLE", "This production house is not accepting pitches right now.");
  if (msg.includes("no active workflow")) return new AppError("COMPANY_UNAVAILABLE", "This production house is not set up to receive pitches yet.");
  return null;
}

type FileRow = typeof publicDraftFiles.$inferSelect;
interface Target { companyId: string; cid: string; pitchId: string; sendId: string }

async function documentCategories(companyId: string, cid: string) {
  const cdb = creatorDb(companyId, cid);
  const rows = await cdb.select({ key: lookupValues.key }).from(lookupValues).where(sql`${lookupValues.type} = 'DOCUMENT_CATEGORY' AND ${lookupValues.active} = true`);
  return new Set(rows.map((r) => r.key));
}

/** Copy one of the writer's files into one production house's pitch as a document. False when it could not be delivered. */
async function deliverFile(db: Db, storage: StoragePort, t: Target, f: FileRow, known: Set<string>): Promise<boolean> {
  const [already] = await db.select({ id: publicSendDocuments.id }).from(publicSendDocuments).where(and(eq(publicSendDocuments.sendId, t.sendId), eq(publicSendDocuments.fileId, f.id)));
  if (already) return true;
  const cdb = creatorDb(t.companyId, t.cid);
  const versionId = randomUUID();
  const ext = f.storageKey.slice(f.storageKey.lastIndexOf(".") + 1);
  const finalKey = `company/${t.companyId}/pitches/${t.pitchId}/documents/${versionId}.${ext}`;
  let copied = false;
  try {
    await cdb.execute(sql`SELECT public.creator_portal_check_upload_quota(${f.sizeBytes})`);
    await storage.copy(f.storageKey, finalKey);
    copied = true;
    const documentId = randomUUID();
    await cdb.insert(documents).values({ id: documentId, pitchId: t.pitchId, categoryKey: known.has(f.categoryKey) ? f.categoryKey : "OTHER", title: f.title, createdByCreatorId: t.cid });
    await cdb.insert(documentVersions).values({
      id: versionId, documentId, versionNo: 1, storageKey: finalKey, originalFilename: f.originalFilename, detectedMime: f.detectedMime,
      sizeBytes: f.sizeBytes, sha256: f.sha256, scanStatus: "NOT_SCANNED", uploadedByCreatorId: t.cid,
    });
    await cdb.update(documents).set({ currentVersionId: versionId }).where(eq(documents.id, documentId));
    await db.insert(publicSendDocuments).values({ sendId: t.sendId, fileId: f.id, documentId, storageKey: finalKey }).onConflictDoNothing();
    return true;
  } catch {
    if (copied) await storage.remove([finalKey]).catch(() => undefined);
    return false;
  }
}

/** Put the writer's current profile onto their record inside the company, so the production house sees who is pitching. */
async function syncProfile(db: Db, storage: StoragePort, companyId: string, cid: string, me: typeof publicCreators.$inferSelect) {
  const credits = await db.select().from(publicCreatorCredits).where(eq(publicCreatorCredits.creatorId, me.id)).orderBy(asc(publicCreatorCredits.createdAt));
  const lines = credits.map((c) => `• ${c.projectTitle} — ${c.credit}${c.releaseYear ? ` (${c.releaseYear})` : ""}`);
  const bio = [me.bio, lines.length ? `Credits:\n${lines.join("\n")}` : null].filter(Boolean).join("\n\n").slice(0, 5000) || null;
  const links = [
    ...(me.imdbUrl ? [{ label: "IMDB", url: me.imdbUrl }] : []),
    ...(me.showreelUrl ? [{ label: "Showreel", url: me.showreelUrl }] : []),
    ...((me.otherLinks as { label: string; url: string }[] | null) ?? []),
  ].slice(0, 12);
  const set: Record<string, unknown> = {
    fullName: me.fullName, nameNormalized: normalizeName(me.fullName), creatorType: me.creatorType, yearsExperience: me.experienceYears, bio, socialLinks: links,
    profileCompletedAt: me.profileCompletedAt,
  };
  if (me.profileImageKey) {
    const ext = me.profileImageKey.slice(me.profileImageKey.lastIndexOf(".") + 1);
    const key = `company/${companyId}/creators/${cid}/photo-${randomUUID()}.${ext}`;
    try { await storage.copy(me.profileImageKey, key); set.profileImageKey = key; } catch { /* the pitch matters more than the photo */ }
  }
  await creatorDb(companyId, cid).update(creators).set(set as never).where(eq(creators.id, cid));
}

export interface SendResult { companyId: string; company: string; ok: boolean; pitchId?: string; filesSent?: number; filesFailed?: number; error?: string }

async function sendToOne(
  db: Db, me: typeof publicCreators.$inferSelect, draft: typeof publicDrafts.$inferSelect, files: FileRow[], companyId: string, storage: StoragePort, ctx: RequestContext,
): Promise<SendResult> {
  const [company] = await db.select({ id: companies.id, name: companies.name }).from(companies)
    .where(and(eq(companies.id, companyId), eq(companies.status, "ACTIVE"), eq(companies.acceptsCreatorSubmissions, true)));
  if (!company) return { companyId, company: "That production house", ok: false, error: "It is not accepting pitches." };
  const fail = (error: string): SendResult => ({ companyId, company: company.name, ok: false, error });

  const [existing] = await db.select({ id: publicDraftSends.id }).from(publicDraftSends).where(and(eq(publicDraftSends.draftId, draft.id), eq(publicDraftSends.companyId, companyId)));
  if (existing) return fail("This pitch is already with them.");

  const cid = companyCreatorId(companyId, me.id);
  let pitchId: string;
  try {
    const reg = creatorDb(companyId, null);
    const base = {
      id: cid, creatorType: me.creatorType as (typeof creators.$inferInsert)["creatorType"], fullName: me.fullName, nameNormalized: normalizeName(me.fullName),
      selfRegistered: true, portalStatus: "ACTIVE" as const, publicCreatorId: me.id,
    };
    try {
      await reg.insert(creators).values({ ...base, mobileE164: me.mobileE164 });
    } catch (e) {
      if (pgCode(e) !== "23505") throw e;
      const c = pgConstraint(e);
      if (c === "creators_company_mobile_uq") await reg.insert(creators).values(base).onConflictDoNothing(); // the company already has someone with this number
      else if (c !== "creators_pkey" && c !== "creators_company_public_creator_uq") throw e;                  // already there: fine
    }
    await syncProfile(db, storage, companyId, cid, me).catch(() => undefined);
    const body: Record<string, unknown> = { title: draft.title, formatKey: draft.formatKey, languageKey: draft.languageKey };
    const optional: [string, unknown][] = [["logline", draft.logline], ["shortSynopsis", draft.shortSynopsis], ["detailedSynopsis", draft.detailedSynopsis],
      ["genreKey", draft.genreKey], ["episodeCount", draft.episodeCount], ["episodeDurationMin", draft.episodeDurationMin], ["targetAudience", draft.targetAudience], ["notes", draft.notes]];
    for (const [k, v] of optional) if (v !== null && v !== undefined) body[k] = v;
    pitchId = (await submitCreatorPitch(companyId, cid, body, ctx)).pitchId;
  } catch (e) {
    const f = friendly(e);
    if (f) return fail(f.message);
    throw e;
  }

  const [send] = await db.insert(publicDraftSends).values({ draftId: draft.id, creatorId: me.id, companyId, companyPitchId: pitchId }).onConflictDoNothing().returning({ id: publicDraftSends.id });
  if (!send) return fail("This pitch is already with them.");
  const t: Target = { companyId, cid, pitchId, sendId: send.id };
  const known = await documentCategories(companyId, cid);
  let sent = 0, failed = 0;
  for (const f of files) { if (await deliverFile(db, storage, t, f, known)) sent++; else failed++; }
  await writeAudit(db, { actorId: null, action: "creator.pitch_sent", resourceType: "public_draft", resourceId: draft.id, after: { companyId, pitchId, files: sent, filesFailed: failed } }, ctx);
  return { companyId, company: company.name, ok: true, pitchId, filesSent: sent, filesFailed: failed };
}

export async function sendDraftToCompanies(
  db: Db, creatorId: string, draftId: string, storage: StoragePort, raw: unknown, ctx: RequestContext = {},
): Promise<{ results: SendResult[] }> {
  const { companyIds } = parseInput(sendSchema, raw);
  const [me] = await db.select().from(publicCreators).where(eq(publicCreators.id, creatorId));
  const [draft] = await db.select().from(publicDrafts).where(and(eq(publicDrafts.id, draftId), eq(publicDrafts.creatorId, creatorId)));
  if (!me || !draft) throw notFound("Draft");
  if (!draft.formatKey || !draft.languageKey) throw new AppError("VALIDATION", "Choose a format and a language before sending your pitch.", { formatKey: "Required", languageKey: "Required" });
  const files = await db.select().from(publicDraftFiles).where(eq(publicDraftFiles.draftId, draftId)).orderBy(asc(publicDraftFiles.createdAt));
  const results: SendResult[] = [];
  for (const id of [...new Set(companyIds)]) {
    try { results.push(await sendToOne(db, me, draft, files, id, storage, ctx)); }
    catch { results.push({ companyId: id, company: "A production house", ok: false, error: "Something went wrong sending to them. Try again." }); }
  }
  return { results };
}

/** A file added after pitching goes to every production house that already has the pitch. Best effort: the writer's own copy is safe. */
export async function deliverToExistingSends(db: Db, storage: StoragePort, draftId: string, fileId: string): Promise<void> {
  const [f] = await db.select().from(publicDraftFiles).where(eq(publicDraftFiles.id, fileId));
  if (!f) return;
  const sends = await db.select().from(publicDraftSends).where(eq(publicDraftSends.draftId, draftId));
  for (const s of sends) {
    const cid = companyCreatorId(s.companyId, s.creatorId);
    try {
      const known = await documentCategories(s.companyId, cid);
      await deliverFile(db, storage, { companyId: s.companyId, cid, pitchId: s.companyPitchId, sendId: s.id }, f, known);
    } catch { /* leave it undelivered; the writer's copy is kept */ }
  }
}
