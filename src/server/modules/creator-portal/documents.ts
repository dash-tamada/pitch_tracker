/**
 * Creator-facing document upload: only kind = 'DOCUMENT' (script/pitch materials) — never IMAGE or
 * CREATOR_PHOTO, which stay staff-only. Same two-phase quarantine-and-validate flow staff use
 * (documents/service.ts): server issues a single-object signed URL into quarantine → browser uploads
 * directly to storage → /complete re-reads the bytes itself, content-sniffs the real type, hashes, and
 * moves to a server-chosen key. A creator never receives a storage credential for anything but its own
 * quarantine object, and nothing becomes a real documents/document_versions row until the server has
 * independently validated the bytes.
 *
 * "Rejected pitches cannot receive uploads" (handoff: "if the pitch is rejected they canot upload to
 * that pitch") is enforced twice: once here, as a friendly error before the browser even uploads bytes
 * (createCreatorUploadIntent, reading pitches.currentStageKey), and again, unavoidably, by Postgres —
 * creator_create_upload_intent / creator_add_document / creator_add_document_version all repeat the
 * same `p.current_stage_key <> 'REJECTED'` check in their WITH CHECK clauses (drizzle/0007_creator_portal.sql
 * §9–§10). A pitch rejected in the gap between this check and the INSERT is caught by the second one.
 */
import { randomUUID, createHash } from "node:crypto";
import { and, eq, inArray, isNull, max, sql } from "drizzle-orm";
import { z } from "zod";
import { creatorDb, type Db } from "@/server/db/client";
import { documentAccessLogs, documents, documentVersions, lookupValues, pitches, uploadIntents } from "@/server/db/schema";
import { AppError, notFound } from "@/server/lib/errors";
import { parseInput } from "@/server/lib/validation";
import { auditPortalAction } from "@/server/modules/creator-portal/auth";
import { DOCUMENT_TYPES, detectAndValidate, extensionOf, sanitizeFilename } from "@/server/modules/storage/file-type";
import { MAX_UPLOAD_BYTES, SIGNED_URL_TTL_SECONDS } from "@/server/modules/storage";
import type { StoragePort } from "@/server/modules/storage/port";
import type { RequestContext } from "@/server/modules/audit/service";

const INTENT_TTL_MS = 2 * 60 * 60 * 1000; // matches the storage provider's signed-upload validity

const createIntentSchema = z.object({
  pitchId: z.uuid(),
  categoryKey: z.string().trim().min(1).max(60),
  title: z.string().trim().min(1).max(200).optional(),
  documentId: z.uuid().optional(),          // set when uploading a new version of an existing document
  versionLabel: z.string().trim().max(60).optional(),
  notes: z.string().trim().max(2000).optional(),
  filename: z.string().trim().min(1).max(255),
  sizeBytes: z.number().int().min(1),
}).strict();

async function assertDocumentCategory(db: Db, key: string) {
  const [hit] = await db.select({ key: lookupValues.key }).from(lookupValues)
    .where(and(eq(lookupValues.type, "DOCUMENT_CATEGORY"), eq(lookupValues.key, key), eq(lookupValues.active, true)));
  if (!hit) throw new AppError("VALIDATION", "Unknown document category.", { categoryKey: "Invalid" });
}

/** Maps the RAISE EXCEPTION message text from creator_portal_check_upload_quota into a user-facing error. */
function quotaErrorMessage(e: unknown): string | undefined {
  const msg = (e as { message?: string })?.message ?? String(e);
  if (msg.includes("file too large")) return "This file is larger than your company's per-file limit.";
  if (msg.includes("storage full")) return "Your company's storage limit has been reached. Contact the company to free up space.";
  if (msg.includes("subscription not active")) return "Uploads are unavailable right now. Contact the company that invited you.";
  return undefined;
}

export interface CreateUploadIntentResult { intentId: string; uploadUrl: string; maxBytes: number }

/** Issues a signed quarantine upload URL. Never for a pitch that is not this creator's own, or that is rejected. */
export async function createCreatorUploadIntent(
  companyId: string, creatorId: string, storage: StoragePort, raw: unknown, now = new Date(),
): Promise<CreateUploadIntentResult> {
  const input = parseInput(createIntentSchema, raw);
  const ext = extensionOf(input.filename);
  if (!(ext in DOCUMENT_TYPES)) {
    throw new AppError("VALIDATION", `Allowed file types: ${[...new Set(Object.keys(DOCUMENT_TYPES))].join(", ").toUpperCase()}.`, { filename: "Type not allowed" });
  }
  const limit = MAX_UPLOAD_BYTES();
  if (input.sizeBytes > limit) throw new AppError("VALIDATION", `File is larger than ${Math.round(limit / 1048576)} MB.`, { sizeBytes: "Too large" });
  if (!input.documentId && !input.title) throw new AppError("VALIDATION", "Give the document a title.", { title: "Required" });

  const db = creatorDb(companyId, creatorId);
  // own-pitch + not-rejected, read straight off the pitches projection (creator_own_pitches RLS already
  // limits this SELECT to the creator's own rows, so a stranger's or made-up pitchId both come back empty).
  const [pitch] = await db.select({ id: pitches.id, currentStageKey: pitches.currentStageKey }).from(pitches).where(eq(pitches.id, input.pitchId));
  if (!pitch) throw notFound("Pitch");
  if (pitch.currentStageKey === "REJECTED") throw new AppError("VALIDATION", "This pitch has been rejected and can no longer receive uploads.");

  await assertDocumentCategory(db, input.categoryKey);
  if (input.documentId) {
    const [d] = await db.select({ id: documents.id }).from(documents)
      .where(and(eq(documents.id, input.documentId), eq(documents.pitchId, input.pitchId), isNull(documents.archivedAt)));
    if (!d) throw notFound("Document");
  }

  try {
    await db.execute(sql`SELECT public.creator_portal_check_upload_quota(${input.sizeBytes})`);
  } catch (e) {
    const msg = quotaErrorMessage(e);
    if (msg) throw new AppError("VALIDATION", msg);
    throw e;
  }

  // Every object key starts with the owning company, so storage housekeeping and exports stay per company.
  const quarantineKey = `company/${companyId}/quarantine/${randomUUID()}.${ext}`;
  const intentId = randomUUID();
  // pitch_creator has SELECT on upload_intents scoped to its own rows (created_by_creator_id =
  // app_creator_id()), and this row's created_by_creator_id is that same id, so — unlike registration's
  // bootstrapping problem — .returning() is safe here: the row is immediately visible to the policy.
  await db.insert(uploadIntents).values({
    id: intentId, kind: "DOCUMENT", pitchId: input.pitchId, documentId: input.documentId ?? null,
    categoryKey: input.categoryKey, title: input.title ?? null, versionLabel: input.versionLabel ?? null, notes: input.notes ?? null,
    originalFilename: sanitizeFilename(input.filename), declaredSizeBytes: input.sizeBytes, quarantineKey,
    createdByCreatorId: creatorId, expiresAt: new Date(now.getTime() + INTENT_TTL_MS),
  });
  const { url } = await storage.createSignedUploadUrl(quarantineKey);
  return { intentId, uploadUrl: url, maxBytes: limit };
}

export interface CompleteUploadResult { documentId: string; versionId: string; versionNo: number }

/** Re-reads the uploaded bytes, validates them by content, and records a new document/document version. */
export async function completeCreatorUpload(
  companyId: string, creatorId: string, storage: StoragePort, intentId: string, ctx: RequestContext = {}, now = new Date(),
): Promise<CompleteUploadResult> {
  const db = creatorDb(companyId, creatorId);
  // creator_own_upload_intents RLS already limits this to the creator's own intent; a stranger's or
  // made-up intentId both come back empty, giving no existence oracle.
  const [intent] = await db.select().from(uploadIntents).where(eq(uploadIntents.id, intentId));
  if (!intent) throw notFound("Upload");
  if (intent.kind !== "DOCUMENT") throw notFound("Upload"); // the portal never issues any other kind
  if (intent.completedAt || intent.rejectedReason) throw new AppError("CONFLICT", "This upload has already been processed.");
  if (intent.expiresAt <= now) throw new AppError("VALIDATION", "This upload has expired. Please start again.");

  // Re-check the pitch is still this creator's own and still not rejected: time may have passed since the
  // intent was created (the RLS WITH CHECK on the INSERT below repeats this regardless, as a backstop).
  const [pitch] = await db.select({ id: pitches.id, currentStageKey: pitches.currentStageKey }).from(pitches).where(eq(pitches.id, intent.pitchId!));
  if (!pitch) throw notFound("Pitch");
  if (pitch.currentStageKey === "REJECTED") throw new AppError("VALIDATION", "This pitch has been rejected and can no longer receive uploads.");

  const limit = MAX_UPLOAD_BYTES();
  const reject = async (reason: string): Promise<never> => {
    await db.update(uploadIntents).set({ rejectedReason: reason.slice(0, 200) }).where(eq(uploadIntents.id, intent.id));
    await storage.remove([intent.quarantineKey]).catch(() => undefined);
    await auditPortalAction(db, "creator_portal.upload_rejected", "pitch", intent.pitchId, { intentId: intent.id, reason });
    throw new AppError("VALIDATION", reason, { file: reason });
  };

  let bytes: Buffer | null;
  try { bytes = await storage.download(intent.quarantineKey, limit); } catch { return reject(`File is larger than ${Math.round(limit / 1048576)} MB.`); }
  if (!bytes) throw new AppError("VALIDATION", "The file has not finished uploading.");
  const verdict = detectAndValidate(bytes, intent.originalFilename, DOCUMENT_TYPES);
  if (!verdict.ok) return reject(verdict.reason);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const ext = verdict.type.ext;

  const versionId = randomUUID();
  const finalKey = `company/${companyId}/pitches/${intent.pitchId}/documents/${versionId}.${ext}`;
  await storage.move(intent.quarantineKey, finalKey);
  try {
    let documentId = intent.documentId;
    if (!documentId) {
      documentId = randomUUID();
      // creator_own_documents RLS requires the owning pitch to belong to this creator — already true here
      // (checked above), so this row is immediately visible back to this same session if ever re-read.
      await db.insert(documents).values({ id: documentId, pitchId: intent.pitchId!, categoryKey: intent.categoryKey!, title: intent.title!, createdByCreatorId: creatorId });
    } else {
      await db.select({ id: documents.id }).from(documents).where(eq(documents.id, documentId)); // presence already re-verified at intent creation
    }
    const [{ v } = { v: 0 }] = await db.select({ v: max(documentVersions.versionNo) }).from(documentVersions).where(eq(documentVersions.documentId, documentId));
    const versionNo = (v ?? 0) + 1;
    await db.insert(documentVersions).values({
      id: versionId, documentId, versionNo, storageKey: finalKey, originalFilename: intent.originalFilename,
      detectedMime: verdict.type.mime, sizeBytes: bytes.length, sha256, scanStatus: "NOT_SCANNED",
      versionLabel: intent.versionLabel, notes: intent.notes, uploadedByCreatorId: creatorId,
    });
    await db.update(documents).set({ currentVersionId: versionId }).where(eq(documents.id, documentId));
    await db.update(uploadIntents).set({ completedAt: now }).where(eq(uploadIntents.id, intent.id));
    await auditPortalAction(db, versionNo === 1 ? "creator_portal.document_uploaded" : "creator_portal.document_version_uploaded", "pitch", intent.pitchId,
      { documentId, versionId, versionNo, categoryKey: intent.categoryKey, sizeBytes: bytes.length, sha256 });
    return { documentId, versionId, versionNo };
  } catch (e) {
    await storage.remove([finalKey]).catch(() => undefined);
    throw e;
  }
}

/** Metadata only (no signed download URL) — enough for the portal to show what has already been uploaded. */
export async function listMyPitchDocuments(companyId: string, creatorId: string, pitchId: string) {
  const db = creatorDb(companyId, creatorId);
  const [pitch] = await db.select({ id: pitches.id }).from(pitches).where(eq(pitches.id, pitchId));
  if (!pitch) throw notFound("Pitch");
  const docs = await db.select().from(documents).where(and(eq(documents.pitchId, pitchId), isNull(documents.archivedAt)));
  if (!docs.length) return [];
  const versionRow = {
    id: documentVersions.id, documentId: documentVersions.documentId, versionNo: documentVersions.versionNo,
    originalFilename: documentVersions.originalFilename, sizeBytes: documentVersions.sizeBytes, createdAt: documentVersions.createdAt,
  };
  const versions = await db.select(versionRow).from(documentVersions)
    .where(inArray(documentVersions.documentId, docs.map((d) => d.id)));
  return docs.map((d) => ({
    id: d.id, categoryKey: d.categoryKey, title: d.title, createdAt: d.createdAt,
    versions: versions.filter((v) => v.documentId === d.id),
  }));
}

/**
 * A creator viewing/downloading their OWN uploaded document — the same 60-second signed URL and
 * access-logging guarantee staff get (documents/service.ts's downloadVersion/viewVersion), scoped to the
 * creator's own pitches by creator_own_document_versions RLS (0007_creator_portal.sql §9), which was
 * granted at the same time as the upload path but never had application code calling it until now.
 */
async function loadMyDownloadableVersion(companyId: string, creatorId: string, versionId: string) {
  const db = creatorDb(companyId, creatorId);
  // creator_own_document_versions / creator_own_documents RLS already limit this join to versions on the
  // creator's own pitches — a stranger's or made-up versionId both come back empty, no existence oracle
  // (same pattern as getMyPitch in pitch.ts).
  const [row] = await db.select({ v: documentVersions, pitchId: documents.pitchId })
    .from(documentVersions).innerJoin(documents, eq(documents.id, documentVersions.documentId))
    .where(eq(documentVersions.id, versionId));
  if (!row) throw notFound("Document");
  if (row.v.scanStatus === "INFECTED" || row.v.scanStatus === "FAILED" || row.v.scanStatus === "PENDING") {
    throw new AppError("FORBIDDEN", "This file is blocked until it passes security checks.");
  }
  return { db, row };
}

/**
 * "Every download is recorded" (the same promise shown to staff) is not best-effort for creators either:
 * this insert is awaited for real, not swallowed — only the separate portal audit-trail call is best-effort.
 * creator_log_own_access's WITH CHECK independently re-derives ownership from document_versions → documents
 * → pitches, so this insert fails closed even if loadMyDownloadableVersion's own check were ever wrong.
 */
async function logMyDocumentAccess(db: Db, creatorId: string, row: { v: typeof documentVersions.$inferSelect; pitchId: string }, action: "DOWNLOAD" | "VIEW") {
  await db.insert(documentAccessLogs).values({ documentVersionId: row.v.id, pitchId: row.pitchId, creatorId, action });
  await auditPortalAction(db, action === "DOWNLOAD" ? "creator_portal.document_downloaded" : "creator_portal.document_viewed", "pitch", row.pitchId, { documentVersionId: row.v.id });
}

/** 60-second signed URL forced as attachment — mirrors documents/service.ts's downloadVersion. */
export async function getMyDownloadUrl(companyId: string, creatorId: string, versionId: string, storage: StoragePort) {
  const { db, row } = await loadMyDownloadableVersion(companyId, creatorId, versionId);
  await logMyDocumentAccess(db, creatorId, row, "DOWNLOAD");
  return storage.createSignedReadUrl(row.v.storageKey, SIGNED_URL_TTL_SECONDS(), row.v.originalFilename);
}

/** Inline-preview URL + mime/filename for DocumentPreview — mirrors documents/service.ts's viewVersion. */
export async function getMyViewUrl(companyId: string, creatorId: string, versionId: string, storage: StoragePort) {
  const { db, row } = await loadMyDownloadableVersion(companyId, creatorId, versionId);
  await logMyDocumentAccess(db, creatorId, row, "VIEW");
  const url = await storage.createSignedReadUrl(row.v.storageKey, SIGNED_URL_TTL_SECONDS(), row.v.originalFilename, { inline: true, contentType: row.v.detectedMime });
  return { url, mime: row.v.detectedMime, filename: row.v.originalFilename };
}
