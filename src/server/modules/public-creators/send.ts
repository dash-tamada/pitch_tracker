/**
 * Sending a platform-wide creator's draft to a company.
 *
 * Everything inside the company runs on the same restricted creator role, through the same row-level-security policies,
 * the company's own creator portal uses (creatorDb) — a company never trusts anything a creator controls beyond what
 * that role is already allowed to write. The creator's company record carries no email or password (it is linked to the
 * platform-wide creator by public_creator_id) and its id is derived from (company, creator), so sending again is safe and
 * a person never gets two records in one company.
 *
 * Not one transaction (the company data and the platform-wide data live behind different database roles), so the steps are
 * ordered to fail safely: the draft is claimed first, and handed back (editable again) if the pitch could not be created.
 */
import { createHash, randomUUID } from "node:crypto";
import { and, asc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { creatorDb } from "@/server/db/client";
import type { Db } from "@/server/db/client";
import { companies, creators, documents, documentVersions, lookupValues, publicCreators, publicDraftFiles, publicDrafts } from "@/server/db/schema";
import { AppError, notFound } from "@/server/lib/errors";
import { normalizeName } from "@/server/lib/pii";
import { parseInput } from "@/server/lib/validation";
import { writeAudit, type RequestContext } from "@/server/modules/audit/service";
import { pgCode, pgConstraint } from "@/server/modules/creator-portal/auth";
import { submitCreatorPitch } from "@/server/modules/creator-portal/pitch";
import type { StoragePort } from "@/server/modules/storage/port";

const sendSchema = z.object({ companyId: z.uuid() }).strict();

/** Companies that are active and have not opted out. Names only: nothing else about a company is shown to creators. */
export async function listSendableCompanies(db: Db) {
  return db.select({ id: companies.id, name: companies.name }).from(companies)
    .where(and(eq(companies.status, "ACTIVE"), eq(companies.acceptsCreatorSubmissions, true))).orderBy(asc(companies.name));
}

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
  if (msg.includes("plan limit reached")) return new AppError("PLAN_LIMIT", "This company cannot accept more pitches right now.");
  if (msg.includes("subscription not active")) return new AppError("COMPANY_UNAVAILABLE", "This company is not accepting pitches right now.");
  if (msg.includes("no active workflow")) return new AppError("COMPANY_UNAVAILABLE", "This company is not set up to receive pitches yet.");
  return null;
}

export interface SendResult { pitchId: string; company: string; filesSent: number; filesFailed: number }

export async function sendDraftToCompany(
  db: Db, creatorId: string, draftId: string, storage: StoragePort, raw: unknown, ctx: RequestContext = {}, now = new Date(),
): Promise<SendResult> {
  const { companyId } = parseInput(sendSchema, raw);
  const [company] = await db.select({ id: companies.id, name: companies.name }).from(companies)
    .where(and(eq(companies.id, companyId), eq(companies.status, "ACTIVE"), eq(companies.acceptsCreatorSubmissions, true)));
  if (!company) throw new AppError("NOT_FOUND", "That company is not accepting pitches.");

  const [me] = await db.select().from(publicCreators).where(eq(publicCreators.id, creatorId));
  const [draft] = await db.select().from(publicDrafts).where(and(eq(publicDrafts.id, draftId), eq(publicDrafts.creatorId, creatorId)));
  if (!me || !draft) throw notFound("Draft");
  if (draft.status !== "DRAFT") throw new AppError("CONFLICT", "This pitch has already been sent.");
  if (!draft.formatKey || !draft.languageKey) throw new AppError("VALIDATION", "Choose a format and a language before sending your pitch.", { formatKey: "Required", languageKey: "Required" });

  // Claim the draft so a double click or a second tab cannot send it twice.
  const [claimed] = await db.update(publicDrafts).set({ status: "SENT", sentCompanyId: companyId, sentAt: now, updatedAt: now })
    .where(and(eq(publicDrafts.id, draftId), eq(publicDrafts.creatorId, creatorId), eq(publicDrafts.status, "DRAFT"))).returning({ id: publicDrafts.id });
  if (!claimed) throw new AppError("CONFLICT", "This pitch has already been sent.");
  const release = () => db.update(publicDrafts).set({ status: "DRAFT", sentCompanyId: null, sentAt: null }).where(eq(publicDrafts.id, draftId));

  const cid = companyCreatorId(companyId, creatorId);
  let pitchId: string;
  try {
    // 1) the creator's record inside the company
    const reg = creatorDb(companyId, null);
    const base = {
      id: cid, creatorType: me.creatorType as (typeof creators.$inferInsert)["creatorType"], fullName: me.fullName, nameNormalized: normalizeName(me.fullName),
      selfRegistered: true, portalStatus: "ACTIVE" as const, publicCreatorId: creatorId,
    };
    try {
      await reg.insert(creators).values({ ...base, mobileE164: me.mobileE164 });
    } catch (e) {
      if (pgCode(e) !== "23505") throw e;
      const c = pgConstraint(e);
      if (c === "creators_company_mobile_uq") await reg.insert(creators).values(base).onConflictDoNothing(); // the company already has someone with this number
      else if (c !== "creators_pkey" && c !== "creators_company_public_creator_uq") throw e;                  // already there: fine
    }
    // 2) the pitch, through the portal's own submission gate (plan limits, subscription, pitch numbering)
    const body: Record<string, unknown> = { title: draft.title, formatKey: draft.formatKey, languageKey: draft.languageKey };
    const optional: [string, unknown][] = [["logline", draft.logline], ["shortSynopsis", draft.shortSynopsis], ["detailedSynopsis", draft.detailedSynopsis],
      ["genreKey", draft.genreKey], ["episodeCount", draft.episodeCount], ["episodeDurationMin", draft.episodeDurationMin], ["targetAudience", draft.targetAudience], ["notes", draft.notes]];
    for (const [k, v] of optional) if (v !== null && v !== undefined) body[k] = v;
    pitchId = (await submitCreatorPitch(companyId, cid, body, ctx)).pitchId;
  } catch (e) {
    await release();
    throw friendly(e) ?? e;
  }

  // 3) the files: moved (not copied) into the company's own storage area and recorded as the pitch's documents
  const files = await db.select().from(publicDraftFiles).where(eq(publicDraftFiles.draftId, draftId));
  const cdb = creatorDb(companyId, cid);
  const known = new Set((await cdb.select({ key: lookupValues.key }).from(lookupValues).where(sql`${lookupValues.type} = 'DOCUMENT_CATEGORY' AND ${lookupValues.active} = true`)).map((r) => r.key));
  let sent = 0, failed = 0;
  for (const f of files) {
    const versionId = randomUUID();
    const ext = f.storageKey.slice(f.storageKey.lastIndexOf(".") + 1);
    const finalKey = `company/${companyId}/pitches/${pitchId}/documents/${versionId}.${ext}`;
    let moved = false;
    try {
      await cdb.execute(sql`SELECT public.creator_portal_check_upload_quota(${f.sizeBytes})`);
      await storage.move(f.storageKey, finalKey);
      moved = true;
      const documentId = randomUUID();
      await cdb.insert(documents).values({ id: documentId, pitchId, categoryKey: known.has(f.categoryKey) ? f.categoryKey : "OTHER", title: f.title, createdByCreatorId: cid });
      await cdb.insert(documentVersions).values({
        id: versionId, documentId, versionNo: 1, storageKey: finalKey, originalFilename: f.originalFilename, detectedMime: f.detectedMime,
        sizeBytes: f.sizeBytes, sha256: f.sha256, scanStatus: "NOT_SCANNED", uploadedByCreatorId: cid,
      });
      await cdb.update(documents).set({ currentVersionId: versionId }).where(eq(documents.id, documentId));
      await db.update(publicDraftFiles).set({ storageKey: finalKey }).where(eq(publicDraftFiles.id, f.id)); // the creator's own link keeps working
      sent++;
    } catch {
      failed++;
      if (moved) await storage.move(finalKey, f.storageKey).catch(() => undefined); // put it back so the creator still has it
    }
  }

  await db.update(publicDrafts).set({ sentPitchId: pitchId }).where(eq(publicDrafts.id, draftId));
  await writeAudit(db, { actorId: null, action: "creator.pitch_sent", resourceType: "public_draft", resourceId: draftId, after: { companyId, pitchId, files: sent, filesFailed: failed } }, ctx);
  return { pitchId, company: company.name, filesSent: sent, filesFailed: failed };
}
