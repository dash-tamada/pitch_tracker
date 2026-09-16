/**
 * Scripts, documents and images.
 *  - Upload: server issues a single-object signed URL into quarantine → browser uploads → /complete re-reads the bytes,
 *    validates type by content, size and macros, hashes, moves to a server-chosen key and records an immutable version.
 *  - Download: permission + pitch access → access log + audit → 60-second signed URL forced as attachment.
 */
import { createHash, randomUUID } from "node:crypto";
import { and, asc, count, desc, eq, gt, inArray, isNull, max, sql } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/server/db/client";
import {
  creators, documentAccessLogs, documents, documentVersions, lookupValues, pitchImages, uploadIntents, users,
} from "@/server/db/schema";
import { AppError, notFound } from "@/server/lib/errors";
import { parseInput } from "@/server/lib/validation";
import { can, requirePermission, type Actor } from "@/server/modules/authz/policy";
import { writeAudit, type RequestContext } from "@/server/modules/audit/service";
import { loadVisiblePitch } from "@/server/modules/workflow/engine";
import { DOCUMENT_TYPES, IMAGE_TYPES, detectAndValidate, extensionOf, sanitizeFilename } from "@/server/modules/storage/file-type";
import { assertCanStore } from "@/server/modules/tenancy/limits";
import { MAX_UPLOAD_BYTES, SIGNED_URL_TTL_SECONDS } from "@/server/modules/storage";
import type { StoragePort } from "@/server/modules/storage/port";

const INTENT_TTL_MS = 2 * 60 * 60 * 1000; // matches the storage provider's signed-upload validity
const MAX_INTENTS_PER_HOUR = 100;
const MAX_IMAGE_BYTES = 15 * 1024 * 1024;

const common = {
  filename: z.string().trim().min(1).max(255),
  sizeBytes: z.number().int().min(1),
};

export const uploadIntentSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("DOCUMENT"), pitchId: z.uuid(), categoryKey: z.string().max(60), title: z.string().trim().min(1).max(200).optional(),
    documentId: z.uuid().optional(), versionLabel: z.string().trim().max(60).optional(), notes: z.string().trim().max(2000).optional(), ...common }).strict(),
  z.object({ kind: z.literal("IMAGE"), pitchId: z.uuid(), categoryKey: z.string().max(60), caption: z.string().trim().max(300).optional(), ...common }).strict(),
  z.object({ kind: z.literal("CREATOR_PHOTO"), creatorId: z.uuid(), ...common }).strict(),
]);

function companyPrefix(actor: Actor): string {
  if (!actor.companyId) throw new AppError("FORBIDDEN", "You do not have permission to do this.");
  return `company/${actor.companyId}`;
}

async function assertLookup(db: Db, type: "DOCUMENT_CATEGORY" | "IMAGE_CATEGORY", key: string) {
  const [hit] = await db.select({ key: lookupValues.key }).from(lookupValues)
    .where(and(eq(lookupValues.type, type), eq(lookupValues.key, key), eq(lookupValues.active, true)));
  if (!hit) throw new AppError("VALIDATION", "Unknown category.", { categoryKey: "Invalid" });
}

export async function createUploadIntent(db: Db, storage: StoragePort, actor: Actor, raw: unknown, now = new Date()) {
  const input = parseInput(uploadIntentSchema, raw);
  const ext = extensionOf(input.filename);
  const allowed = input.kind === "DOCUMENT" ? DOCUMENT_TYPES : IMAGE_TYPES;
  if (!(ext in allowed)) throw new AppError("VALIDATION", `Allowed file types: ${[...new Set(Object.keys(allowed))].join(", ").toUpperCase()}.`, { filename: "Type not allowed" });
  const limit = input.kind === "DOCUMENT" ? MAX_UPLOAD_BYTES() : MAX_IMAGE_BYTES;
  if (input.sizeBytes > limit) throw new AppError("VALIDATION", `File is larger than ${Math.round(limit / 1048576)} MB.`, { sizeBytes: "Too large" });

  if (input.kind === "CREATOR_PHOTO") {
    requirePermission(actor, "creator.edit");
    const [c] = await db.select({ id: creators.id }).from(creators).where(and(eq(creators.id, input.creatorId), isNull(creators.archivedAt)));
    if (!c) throw notFound("Creator");
  } else {
    requirePermission(actor, "document.upload");
    const pitch = await loadVisiblePitch(db, actor, input.pitchId, false);
    if (pitch.archivedAt) throw new AppError("VALIDATION", "Archived pitches cannot receive uploads.");
    await assertLookup(db, input.kind === "DOCUMENT" ? "DOCUMENT_CATEGORY" : "IMAGE_CATEGORY", input.categoryKey);
    if (input.kind === "DOCUMENT" && input.documentId) {
      const [d] = await db.select({ id: documents.id }).from(documents)
        .where(and(eq(documents.id, input.documentId), eq(documents.pitchId, input.pitchId), isNull(documents.archivedAt)));
      if (!d) throw notFound("Document");
    }
    if (input.kind === "DOCUMENT" && !input.documentId && !input.title) throw new AppError("VALIDATION", "Give the document a title.", { title: "Required" });
  }

  const [recent] = await db.select({ n: count() }).from(uploadIntents)
    .where(and(eq(uploadIntents.createdById, actor.userId), gt(uploadIntents.createdAt, new Date(now.getTime() - 3_600_000))));
  if ((recent?.n ?? 0) >= MAX_INTENTS_PER_HOUR) throw new AppError("RATE_LIMITED", "Too many uploads in the last hour.");

  if (input.kind === "DOCUMENT") await assertCanStore(db, input.sizeBytes);
  // Every object key starts with the owning company, so storage housekeeping and exports stay per company.
  const quarantineKey = `${companyPrefix(actor)}/quarantine/${randomUUID()}.${ext}`;
  const [intent] = await db.insert(uploadIntents).values({
    kind: input.kind,
    pitchId: input.kind === "CREATOR_PHOTO" ? null : input.pitchId,
    creatorId: input.kind === "CREATOR_PHOTO" ? input.creatorId : null,
    documentId: input.kind === "DOCUMENT" ? input.documentId ?? null : null,
    categoryKey: input.kind === "CREATOR_PHOTO" ? null : input.categoryKey,
    title: input.kind === "DOCUMENT" ? input.title ?? null : null,
    caption: input.kind === "IMAGE" ? input.caption ?? null : null,
    versionLabel: input.kind === "DOCUMENT" ? input.versionLabel ?? null : null,
    notes: input.kind === "DOCUMENT" ? input.notes ?? null : null,
    originalFilename: sanitizeFilename(input.filename), declaredSizeBytes: input.sizeBytes, quarantineKey,
    createdById: actor.userId, expiresAt: new Date(now.getTime() + INTENT_TTL_MS),
  }).returning({ id: uploadIntents.id });
  const { url } = await storage.createSignedUploadUrl(quarantineKey);
  return { intentId: intent!.id, uploadUrl: url, maxBytes: limit };
}

export async function completeUpload(db: Db, storage: StoragePort, actor: Actor, intentId: string, ctx: RequestContext = {}, now = new Date()) {
  const [intent] = await db.select().from(uploadIntents).where(and(eq(uploadIntents.id, intentId), eq(uploadIntents.createdById, actor.userId)));
  if (!intent) throw notFound("Upload");
  if (intent.completedAt || intent.rejectedReason) throw new AppError("CONFLICT", "This upload has already been processed.");
  if (intent.expiresAt <= now) throw new AppError("VALIDATION", "This upload has expired. Please start again.");

  // Re-check authorization at completion: permissions or access may have changed since the intent was issued.
  if (intent.kind === "CREATOR_PHOTO") requirePermission(actor, "creator.edit");
  else { requirePermission(actor, "document.upload"); await loadVisiblePitch(db, actor, intent.pitchId!, false); }

  const limit = intent.kind === "DOCUMENT" ? MAX_UPLOAD_BYTES() : MAX_IMAGE_BYTES;
  const reject = async (reason: string): Promise<never> => {
    await db.update(uploadIntents).set({ rejectedReason: reason.slice(0, 200) }).where(eq(uploadIntents.id, intent.id));
    await storage.remove([intent.quarantineKey]).catch(() => undefined);
    await writeAudit(db, { actorId: actor.userId, action: "upload.rejected", resourceType: intent.kind === "CREATOR_PHOTO" ? "creator" : "pitch",
      resourceId: intent.creatorId ?? intent.pitchId, after: { intentId: intent.id, reason } }, ctx);
    throw new AppError("VALIDATION", reason, { file: reason });
  };

  let bytes: Buffer | null;
  try { bytes = await storage.download(intent.quarantineKey, limit); } catch { return reject(`File is larger than ${Math.round(limit / 1048576)} MB.`); }
  if (!bytes) throw new AppError("VALIDATION", "The file has not finished uploading.");
  const verdict = detectAndValidate(bytes, intent.originalFilename, intent.kind === "DOCUMENT" ? DOCUMENT_TYPES : IMAGE_TYPES);
  if (!verdict.ok) return reject(verdict.reason);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const ext = verdict.type.ext;

  if (intent.kind === "CREATOR_PHOTO") {
    const finalKey = `${companyPrefix(actor)}/creators/${intent.creatorId}/photo-${randomUUID()}.${ext}`;
    await storage.move(intent.quarantineKey, finalKey);
    try {
      const old = await db.transaction(async (tx) => {
        const [c] = await tx.select({ key: creators.profileImageKey }).from(creators).where(eq(creators.id, intent.creatorId!)).for("update");
        await tx.update(creators).set({ profileImageKey: finalKey }).where(eq(creators.id, intent.creatorId!));
        await tx.update(uploadIntents).set({ completedAt: now }).where(eq(uploadIntents.id, intent.id));
        await writeAudit(tx, { actorId: actor.userId, action: "creator.photo_updated", resourceType: "creator", resourceId: intent.creatorId, after: { sha256 } }, ctx);
        return c?.key ?? null;
      });
      if (old) await storage.remove([old]).catch(() => undefined);
    } catch (e) { await storage.remove([finalKey]).catch(() => undefined); throw e; }
    return { kind: intent.kind, creatorId: intent.creatorId };
  }

  if (intent.kind === "IMAGE") {
    await assertCanStore(db, bytes.length);
    const finalKey = `${companyPrefix(actor)}/pitches/${intent.pitchId}/images/${randomUUID()}.${ext}`;
    await storage.move(intent.quarantineKey, finalKey);
    try {
      return await db.transaction(async (tx) => {
        const [img] = await tx.insert(pitchImages).values({ pitchId: intent.pitchId!, categoryKey: intent.categoryKey!, caption: intent.caption,
          storageKey: finalKey, detectedMime: verdict.type.mime, sizeBytes: bytes.length, sha256, scanStatus: "NOT_SCANNED", uploadedById: actor.userId })
          .returning({ id: pitchImages.id });
        await tx.update(uploadIntents).set({ completedAt: now }).where(eq(uploadIntents.id, intent.id));
        await writeAudit(tx, { actorId: actor.userId, action: "image.uploaded", resourceType: "pitch", resourceId: intent.pitchId,
          after: { imageId: img!.id, categoryKey: intent.categoryKey, sizeBytes: bytes.length, sha256 } }, ctx);
        return { kind: intent.kind, imageId: img!.id };
      });
    } catch (e) { await storage.remove([finalKey]).catch(() => undefined); throw e; }
  }

  // DOCUMENT → new document or new version; never overwrites.
  await assertCanStore(db, bytes.length);
  const versionId = randomUUID();
  const finalKey = `${companyPrefix(actor)}/pitches/${intent.pitchId}/documents/${versionId}.${ext}`;
  await storage.move(intent.quarantineKey, finalKey);
  try {
    return await db.transaction(async (tx) => {
      let documentId = intent.documentId;
      if (!documentId) {
        const [d] = await tx.insert(documents).values({ pitchId: intent.pitchId!, categoryKey: intent.categoryKey!, title: intent.title!, createdById: actor.userId })
          .returning({ id: documents.id });
        documentId = d!.id;
      } else {
        await tx.select({ id: documents.id }).from(documents).where(eq(documents.id, documentId)).for("update"); // serialize version numbering
      }
      const [{ v } = { v: 0 }] = await tx.select({ v: max(documentVersions.versionNo) }).from(documentVersions).where(eq(documentVersions.documentId, documentId));
      const versionNo = (v ?? 0) + 1;
      await tx.insert(documentVersions).values({ id: versionId, documentId, versionNo, storageKey: finalKey, originalFilename: intent.originalFilename,
        detectedMime: verdict.type.mime, sizeBytes: bytes.length, sha256, scanStatus: "NOT_SCANNED", versionLabel: intent.versionLabel,
        notes: intent.notes, uploadedById: actor.userId });
      await tx.update(documents).set({ currentVersionId: versionId }).where(eq(documents.id, documentId));
      await tx.update(uploadIntents).set({ completedAt: now }).where(eq(uploadIntents.id, intent.id));
      await writeAudit(tx, { actorId: actor.userId, action: versionNo === 1 ? "document.uploaded" : "document.version_uploaded", resourceType: "pitch",
        resourceId: intent.pitchId, after: { documentId, versionId, versionNo, categoryKey: intent.categoryKey, sizeBytes: bytes.length, sha256 } }, ctx);
      return { kind: intent.kind, documentId, versionId, versionNo };
    });
  } catch (e) { await storage.remove([finalKey]).catch(() => undefined); throw e; }
}

export async function listPitchDocuments(db: Db, actor: Actor, pitchId: string) {
  requirePermission(actor, "document.view_meta");
  await loadVisiblePitch(db, actor, pitchId, false);
  const docs = await db.select().from(documents).where(and(eq(documents.pitchId, pitchId), isNull(documents.archivedAt))).orderBy(asc(documents.categoryKey), asc(documents.createdAt));
  if (!docs.length) return [];
  const versions = await db.select({ id: documentVersions.id, documentId: documentVersions.documentId, versionNo: documentVersions.versionNo,
    originalFilename: documentVersions.originalFilename, detectedMime: documentVersions.detectedMime, sizeBytes: documentVersions.sizeBytes,
    sha256: documentVersions.sha256, scanStatus: documentVersions.scanStatus, versionLabel: documentVersions.versionLabel, notes: documentVersions.notes,
    uploadedById: documentVersions.uploadedById, uploadedByName: users.fullName, createdAt: documentVersions.createdAt })
    .from(documentVersions).innerJoin(users, eq(users.id, documentVersions.uploadedById))
    .where(inArray(documentVersions.documentId, docs.map((d) => d.id))).orderBy(desc(documentVersions.versionNo));
  return docs.map((d) => ({ ...d, versions: versions.filter((v) => v.documentId === d.id).map((v) => ({ ...v, isCurrent: v.id === d.currentVersionId })) }));
}

/** Shared by downloadVersion/viewVersion: same permission, visibility, archive and scan-status checks either way. */
async function loadDownloadableVersion(db: Db, actor: Actor, versionId: string) {
  requirePermission(actor, "document.download");
  const [row] = await db.select({ v: documentVersions, pitchId: documents.pitchId, docArchived: documents.archivedAt })
    .from(documentVersions).innerJoin(documents, eq(documents.id, documentVersions.documentId)).where(eq(documentVersions.id, versionId));
  if (!row) throw notFound("Document");
  await loadVisiblePitch(db, actor, row.pitchId, false); // NOT_FOUND if the pitch is not visible
  if (row.docArchived && !can(actor, "pitch.restore")) throw notFound("Document");
  if (row.v.scanStatus === "INFECTED" || row.v.scanStatus === "FAILED" || row.v.scanStatus === "PENDING") {
    throw new AppError("FORBIDDEN", "This file is blocked until it passes security checks.");
  }
  return row;
}

async function logDocumentAccess(db: Db, actor: Actor, row: { v: typeof documentVersions.$inferSelect; pitchId: string },
  action: "DOWNLOAD" | "VIEW", ctx: RequestContext) {
  await db.transaction(async (tx) => {
    await tx.insert(documentAccessLogs).values({ documentVersionId: row.v.id, pitchId: row.pitchId, userId: actor.userId, action,
      ip: ctx.ip ?? null, userAgent: ctx.userAgent?.slice(0, 512) ?? null });
    await writeAudit(tx, { actorId: actor.userId, action: action === "DOWNLOAD" ? "document.downloaded" : "document.viewed", resourceType: "pitch", resourceId: row.pitchId,
      after: { documentId: row.v.documentId, versionId: row.v.id, versionNo: row.v.versionNo } }, ctx);
  });
}

/** 60-second signed URL forced as attachment (a download prompt), for "who downloaded this script?" logging. */
export async function downloadVersion(db: Db, storage: StoragePort, actor: Actor, versionId: string, ctx: RequestContext = {}) {
  const row = await loadDownloadableVersion(db, actor, versionId);
  await logDocumentAccess(db, actor, row, "DOWNLOAD", ctx);
  return storage.createSignedReadUrl(row.v.storageKey, SIGNED_URL_TTL_SECONDS(), row.v.originalFilename);
}

/** Same checks and logging as downloadVersion, but the URL renders inline (a popup preview) instead of prompting to save. */
export async function viewVersion(db: Db, storage: StoragePort, actor: Actor, versionId: string, ctx: RequestContext = {}) {
  const row = await loadDownloadableVersion(db, actor, versionId);
  await logDocumentAccess(db, actor, row, "VIEW", ctx);
  return storage.createSignedReadUrl(row.v.storageKey, SIGNED_URL_TTL_SECONDS(), row.v.originalFilename, { inline: true, contentType: row.v.detectedMime });
}

/** "Who downloaded this script?" — management only. */
export async function versionAccessLog(db: Db, actor: Actor, versionId: string) {
  requirePermission(actor, "pitch.view_all");
  const [row] = await db.select({ pitchId: documents.pitchId }).from(documentVersions).innerJoin(documents, eq(documents.id, documentVersions.documentId)).where(eq(documentVersions.id, versionId));
  if (!row) throw notFound("Document");
  await loadVisiblePitch(db, actor, row.pitchId, false);
  return db.select({ userName: users.fullName, action: documentAccessLogs.action, at: documentAccessLogs.createdAt })
    .from(documentAccessLogs).innerJoin(users, eq(users.id, documentAccessLogs.userId))
    .where(eq(documentAccessLogs.documentVersionId, versionId)).orderBy(desc(documentAccessLogs.createdAt)).limit(500);
}

export async function pitchDownloadLog(db: Db, actor: Actor, pitchId: string) {
  requirePermission(actor, "pitch.view_all");
  await loadVisiblePitch(db, actor, pitchId, false);
  return db.select({ userName: users.fullName, versionNo: documentVersions.versionNo, title: documents.title, action: documentAccessLogs.action, at: documentAccessLogs.createdAt })
    .from(documentAccessLogs).innerJoin(users, eq(users.id, documentAccessLogs.userId))
    .innerJoin(documentVersions, eq(documentVersions.id, documentAccessLogs.documentVersionId))
    .innerJoin(documents, eq(documents.id, documentVersions.documentId))
    .where(eq(documentAccessLogs.pitchId, pitchId)).orderBy(desc(documentAccessLogs.createdAt)).limit(500);
}

export async function setCurrentVersion(db: Db, actor: Actor, documentId: string, versionId: string, ctx: RequestContext = {}) {
  requirePermission(actor, "document.upload");
  return db.transaction(async (tx) => {
    const [d] = await tx.select().from(documents).where(eq(documents.id, documentId)).for("update");
    if (!d) throw notFound("Document");
    await loadVisiblePitch(tx as unknown as Db, actor, d.pitchId, false);
    const [v] = await tx.select({ id: documentVersions.id, versionNo: documentVersions.versionNo }).from(documentVersions)
      .where(and(eq(documentVersions.id, versionId), eq(documentVersions.documentId, documentId)));
    if (!v) throw notFound("Version");
    await tx.update(documents).set({ currentVersionId: versionId }).where(eq(documents.id, documentId));
    await writeAudit(tx, { actorId: actor.userId, action: "document.current_version_changed", resourceType: "pitch", resourceId: d.pitchId,
      before: { currentVersionId: d.currentVersionId }, after: { currentVersionId: versionId, versionNo: v.versionNo } }, ctx);
    return { documentId, versionId };
  });
}

export async function listPitchImages(db: Db, storage: StoragePort, actor: Actor, pitchId: string) {
  requirePermission(actor, "document.view_meta");
  await loadVisiblePitch(db, actor, pitchId, false);
  const rows = await db.select().from(pitchImages).where(and(eq(pitchImages.pitchId, pitchId), isNull(pitchImages.archivedAt))).orderBy(desc(pitchImages.createdAt)).limit(200);
  const ttl = SIGNED_URL_TTL_SECONDS() * 5; // images render in page; still short-lived
  return Promise.all(rows.filter((r) => r.scanStatus !== "INFECTED" && r.scanStatus !== "FAILED")
    .map(async (r) => ({ id: r.id, categoryKey: r.categoryKey, caption: r.caption, sizeBytes: r.sizeBytes, createdAt: r.createdAt,
      url: await storage.createSignedReadUrl(r.storageKey, ttl) })));
}

export async function creatorPhotoUrl(db: Db, storage: StoragePort, actor: Actor, creatorId: string) {
  requirePermission(actor, "creator.view");
  const [c] = await db.select({ key: creators.profileImageKey }).from(creators).where(eq(creators.id, creatorId));
  if (!c?.key) return null;
  return storage.createSignedReadUrl(c.key, SIGNED_URL_TTL_SECONDS() * 5);
}

export async function documentCounts(db: Db, pitchId: string) {
  const [r] = await db.select({ docs: sql<number>`count(DISTINCT ${documents.id})::int` }).from(documents).where(and(eq(documents.pitchId, pitchId), isNull(documents.archivedAt)));
  return r?.docs ?? 0;
}
