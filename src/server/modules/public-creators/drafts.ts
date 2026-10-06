/**
 * A platform-wide creator's own pitch drafts and uploads. Every query is pinned to the signed-in creator's id
 * (taken from the session, never from the request), so a draft or file id that is not theirs behaves exactly like
 * one that does not exist. Uploads use the same quarantine → validate-by-content → move flow staff and the company
 * portal use; nothing is kept until the server has read the bytes itself.
 */
import { createHash, randomUUID } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/server/db/client";
import { publicDraftFiles, publicDraftUploads, publicDrafts } from "@/server/db/schema";
import { AppError, notFound } from "@/server/lib/errors";
import { parseInput } from "@/server/lib/validation";
import { MAX_UPLOAD_BYTES, SIGNED_URL_TTL_SECONDS } from "@/server/modules/storage";
import { DOCUMENT_TYPES, detectAndValidate, extensionOf, sanitizeFilename } from "@/server/modules/storage/file-type";
import type { StoragePort } from "@/server/modules/storage/port";

/** Same keys the company configuration uses, so a draft maps straight onto a company's pitch when it is sent. */
export const FORMATS: [string, string][] = [["FEATURE_FILM", "Feature Film"], ["WEB_SERIES", "Web Series"], ["TV_SERIES", "TV Series"], ["SHORT_FILM", "Short Film"], ["DOCUMENTARY", "Documentary"], ["REALITY", "Reality"], ["OTHER", "Other"]];
export const LANGUAGES: [string, string][] = [["TELUGU", "Telugu"], ["HINDI", "Hindi"], ["TAMIL", "Tamil"], ["KANNADA", "Kannada"], ["MALAYALAM", "Malayalam"], ["ENGLISH", "English"], ["OTHER", "Other"]];
export const GENRES: [string, string][] = [["DRAMA", "Drama"], ["THRILLER", "Thriller"], ["CRIME", "Crime"], ["COMEDY", "Comedy"], ["ROMANCE", "Romance"], ["ACTION", "Action"], ["HORROR", "Horror"], ["FAMILY", "Family"], ["MYTHOLOGY", "Mythology"], ["SCI_FI", "Sci-Fi"], ["FANTASY", "Fantasy"], ["DOCUMENTARY", "Documentary"], ["OTHER", "Other"]];
export const FILE_CATEGORIES: [string, string][] = [["SCRIPT", "Script"], ["SYNOPSIS", "Synopsis"], ["ONE_LINE", "One-line"], ["CHARACTER_DOC", "Character document"], ["DIRECTORS_NOTE", "Director's note"], ["PITCH_DECK", "Pitch deck"], ["REFERENCE", "Reference material"], ["POSTER", "Poster"], ["OTHER", "Other"]];
const EPISODIC = new Set(["WEB_SERIES", "TV_SERIES"]);
const oneOf = (list: [string, string][]) => z.string().refine((v) => list.some(([k]) => k === v), "Unknown option");
const opt = (max: number) => z.string().trim().max(max).optional().transform((v) => (v === "" ? undefined : v));

const draftSchema = z.object({
  title: z.string().trim().min(1).max(200),
  logline: opt(500), shortSynopsis: opt(5000), detailedSynopsis: opt(100000),
  formatKey: oneOf(FORMATS).optional(), languageKey: oneOf(LANGUAGES).optional(), genreKey: oneOf(GENRES).optional(),
  episodeCount: z.number().int().min(1).max(1000).optional(), episodeDurationMin: z.number().int().min(1).max(600).optional(),
  targetAudience: opt(200), notes: opt(5000),
}).strict();

async function ownDraft(db: Db, creatorId: string, draftId: string) {
  const [d] = await db.select().from(publicDrafts).where(and(eq(publicDrafts.id, draftId), eq(publicDrafts.creatorId, creatorId)));
  if (!d) throw notFound("Draft");
  return d;
}
function assertEditable(d: { status: string }) {
  if (d.status !== "DRAFT") throw new AppError("CONFLICT", "This pitch has already been sent and can no longer be edited here.");
}
function values(input: z.infer<typeof draftSchema>) {
  const episodic = input.formatKey ? EPISODIC.has(input.formatKey) : false;
  return {
    title: input.title, logline: input.logline ?? null, shortSynopsis: input.shortSynopsis ?? null, detailedSynopsis: input.detailedSynopsis ?? null,
    formatKey: input.formatKey ?? null, languageKey: input.languageKey ?? null, genreKey: input.genreKey ?? null,
    episodeCount: episodic ? input.episodeCount ?? null : null, episodeDurationMin: input.episodeDurationMin ?? null,
    targetAudience: input.targetAudience ?? null, notes: input.notes ?? null,
  };
}

export const listMyDrafts = (db: Db, creatorId: string) =>
  db.select({ id: publicDrafts.id, title: publicDrafts.title, status: publicDrafts.status, updatedAt: publicDrafts.updatedAt, logline: publicDrafts.logline })
    .from(publicDrafts).where(eq(publicDrafts.creatorId, creatorId)).orderBy(desc(publicDrafts.updatedAt));

export async function createDraft(db: Db, creatorId: string, raw: unknown): Promise<{ id: string }> {
  const input = parseInput(draftSchema, raw);
  const [row] = await db.insert(publicDrafts).values({ creatorId, ...values(input) }).returning({ id: publicDrafts.id });
  return { id: row!.id };
}

export async function getMyDraft(db: Db, creatorId: string, draftId: string) {
  const draft = await ownDraft(db, creatorId, draftId);
  const files = await db.select({ id: publicDraftFiles.id, title: publicDraftFiles.title, categoryKey: publicDraftFiles.categoryKey, originalFilename: publicDraftFiles.originalFilename, sizeBytes: publicDraftFiles.sizeBytes, createdAt: publicDraftFiles.createdAt })
    .from(publicDraftFiles).where(and(eq(publicDraftFiles.draftId, draftId), eq(publicDraftFiles.creatorId, creatorId))).orderBy(publicDraftFiles.createdAt);
  return { draft, files };
}

export async function updateDraft(db: Db, creatorId: string, draftId: string, raw: unknown): Promise<{ ok: true }> {
  assertEditable(await ownDraft(db, creatorId, draftId));
  const input = parseInput(draftSchema, raw);
  await db.update(publicDrafts).set({ ...values(input), updatedAt: new Date() }).where(and(eq(publicDrafts.id, draftId), eq(publicDrafts.creatorId, creatorId)));
  return { ok: true };
}

export async function deleteDraft(db: Db, creatorId: string, draftId: string, storage: StoragePort): Promise<{ ok: true }> {
  assertEditable(await ownDraft(db, creatorId, draftId));
  const files = await db.select({ key: publicDraftFiles.storageKey }).from(publicDraftFiles).where(eq(publicDraftFiles.draftId, draftId));
  await db.delete(publicDrafts).where(and(eq(publicDrafts.id, draftId), eq(publicDrafts.creatorId, creatorId)));
  await storage.remove(files.map((f) => f.key)).catch(() => undefined);
  return { ok: true };
}

/* ───────────── uploads ───────────── */
const INTENT_TTL_MS = 2 * 60 * 60 * 1000;
const MAX_FILES_PER_DRAFT = 30;
const intentSchema = z.object({
  categoryKey: oneOf(FILE_CATEGORIES), title: z.string().trim().min(1).max(200),
  filename: z.string().trim().min(1).max(255), sizeBytes: z.number().int().min(1),
}).strict();

export async function createUploadIntent(db: Db, creatorId: string, draftId: string, storage: StoragePort, raw: unknown, now = new Date()) {
  assertEditable(await ownDraft(db, creatorId, draftId));
  const input = parseInput(intentSchema, raw);
  const ext = extensionOf(input.filename);
  if (!(ext in DOCUMENT_TYPES)) throw new AppError("VALIDATION", `Allowed file types: ${[...new Set(Object.keys(DOCUMENT_TYPES))].join(", ").toUpperCase()}.`, { filename: "Type not allowed" });
  const limit = MAX_UPLOAD_BYTES();
  if (input.sizeBytes > limit) throw new AppError("VALIDATION", `File is larger than ${Math.round(limit / 1048576)} MB.`, { sizeBytes: "Too large" });
  const existing = await db.select({ id: publicDraftFiles.id }).from(publicDraftFiles).where(eq(publicDraftFiles.draftId, draftId));
  if (existing.length >= MAX_FILES_PER_DRAFT) throw new AppError("PLAN_LIMIT", `A pitch can have up to ${MAX_FILES_PER_DRAFT} files.`);

  const id = randomUUID();
  const quarantineKey = `public/${creatorId}/quarantine/${randomUUID()}.${ext}`;
  await db.insert(publicDraftUploads).values({
    id, draftId, creatorId, categoryKey: input.categoryKey, title: input.title, originalFilename: sanitizeFilename(input.filename),
    declaredSizeBytes: input.sizeBytes, quarantineKey, expiresAt: new Date(now.getTime() + INTENT_TTL_MS),
  });
  const { url } = await storage.createSignedUploadUrl(quarantineKey);
  return { intentId: id, uploadUrl: url, maxBytes: limit };
}

export async function completeUpload(db: Db, creatorId: string, draftId: string, intentId: string, storage: StoragePort, now = new Date()) {
  assertEditable(await ownDraft(db, creatorId, draftId));
  const [intent] = await db.select().from(publicDraftUploads)
    .where(and(eq(publicDraftUploads.id, intentId), eq(publicDraftUploads.draftId, draftId), eq(publicDraftUploads.creatorId, creatorId)));
  if (!intent) throw notFound("Upload");
  if (intent.completedAt || intent.rejectedReason) throw new AppError("CONFLICT", "This upload has already been processed.");
  if (intent.expiresAt <= now) throw new AppError("VALIDATION", "This upload has expired. Please start again.");

  const limit = MAX_UPLOAD_BYTES();
  const reject = async (reason: string): Promise<never> => {
    await db.update(publicDraftUploads).set({ rejectedReason: reason.slice(0, 200) }).where(eq(publicDraftUploads.id, intent.id));
    await storage.remove([intent.quarantineKey]).catch(() => undefined);
    throw new AppError("VALIDATION", reason, { file: reason });
  };
  let bytes: Buffer | null;
  try { bytes = await storage.download(intent.quarantineKey, limit); } catch { return reject(`File is larger than ${Math.round(limit / 1048576)} MB.`); }
  if (!bytes) throw new AppError("VALIDATION", "The file has not finished uploading.");
  const verdict = detectAndValidate(bytes, intent.originalFilename, DOCUMENT_TYPES);
  if (!verdict.ok) return reject(verdict.reason);

  const fileId = randomUUID();
  const finalKey = `public/${creatorId}/drafts/${draftId}/${fileId}.${verdict.type.ext}`;
  await storage.move(intent.quarantineKey, finalKey);
  try {
    await db.insert(publicDraftFiles).values({
      id: fileId, draftId, creatorId, categoryKey: intent.categoryKey, title: intent.title, originalFilename: intent.originalFilename,
      detectedMime: verdict.type.mime, sizeBytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex"), storageKey: finalKey,
    });
    await db.update(publicDraftUploads).set({ completedAt: now }).where(eq(publicDraftUploads.id, intent.id));
    await db.update(publicDrafts).set({ updatedAt: now }).where(eq(publicDrafts.id, draftId));
  } catch (e) {
    await storage.remove([finalKey]).catch(() => undefined);
    throw e;
  }
  return { fileId };
}

export async function removeFile(db: Db, creatorId: string, draftId: string, fileId: string, storage: StoragePort): Promise<{ ok: true }> {
  assertEditable(await ownDraft(db, creatorId, draftId));
  const [f] = await db.select().from(publicDraftFiles).where(and(eq(publicDraftFiles.id, fileId), eq(publicDraftFiles.draftId, draftId), eq(publicDraftFiles.creatorId, creatorId)));
  if (!f) throw notFound("File");
  await db.delete(publicDraftFiles).where(eq(publicDraftFiles.id, f.id));
  await storage.remove([f.storageKey]).catch(() => undefined);
  return { ok: true };
}

/** A short-lived link to the creator's own file, forced as a download. */
export async function fileDownloadUrl(db: Db, creatorId: string, draftId: string, fileId: string, storage: StoragePort): Promise<string> {
  const [f] = await db.select().from(publicDraftFiles).where(and(eq(publicDraftFiles.id, fileId), eq(publicDraftFiles.draftId, draftId), eq(publicDraftFiles.creatorId, creatorId)));
  if (!f) throw notFound("File");
  return storage.createSignedReadUrl(f.storageKey, SIGNED_URL_TTL_SECONDS(), f.originalFilename);
}
