/**
 * A writer's own profile in the Creator Studio: experience, projects with credits, profile photo, IMDB / showreel / other
 * links. Everything is pinned to the signed-in writer's id (from the session, never the request). The photo is the one
 * required item: the studio stays closed until there is one. Links must be real web addresses, never scripts.
 */
import { createHash, randomUUID } from "node:crypto";
import { asc, desc, eq } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/server/db/client";
import { publicCreatorCredits, publicCreators } from "@/server/db/schema";
import { AppError, notFound } from "@/server/lib/errors";
import { parseInput } from "@/server/lib/validation";
import { SIGNED_URL_TTL_SECONDS } from "@/server/modules/storage";
import { IMAGE_TYPES, detectAndValidate, extensionOf } from "@/server/modules/storage/file-type";
import type { StoragePort } from "@/server/modules/storage/port";

export const CREATOR_TYPES = ["WRITER", "DIRECTOR", "WRITER_DIRECTOR", "PRODUCER", "CREATOR", "OTHER"] as const;
export const CREATOR_TYPE_LABEL: Record<(typeof CREATOR_TYPES)[number], string> = {
  WRITER: "Writer", DIRECTOR: "Director", WRITER_DIRECTOR: "Writer-Director", PRODUCER: "Producer", CREATOR: "Creator", OTHER: "Other",
};
const PHOTO_MAX_BYTES = 8 * 1024 * 1024;

function isWebUrl(v: string): boolean {
  try { const u = new URL(v); return u.protocol === "https:" || u.protocol === "http:"; } catch { return false; }
}
const webUrl = z.string().trim().max(500).refine(isWebUrl, "Enter a full web address starting with http:// or https://");
const optionalUrl = z.union([z.literal("").transform(() => undefined), webUrl]).optional();
const imdbUrl = z.union([z.literal("").transform(() => undefined), webUrl.refine((v) => /(^|\.)imdb\.com$/i.test(new URL(v).hostname), "That is not an IMDB address")]).optional();
const optionalYear = z.number().int().min(1900).max(2100).optional();

/** Everything a writer tells us about themselves, at sign-up and whenever they edit their profile. */
export const detailsSchema = z.object({
  fullName: z.string().trim().min(2).max(120),
  creatorType: z.enum(CREATOR_TYPES),
  experienceYears: z.number().int().min(0).max(80).optional(),
  bio: z.string().trim().max(2000).optional().transform((v) => (v === "" ? undefined : v)),
  imdbUrl, showreelUrl: optionalUrl,
  otherLinks: z.array(z.object({ label: z.string().trim().min(1).max(40), url: webUrl })).max(8).default([]),
  credits: z.array(z.object({
    projectTitle: z.string().trim().min(1).max(200), credit: z.string().trim().min(1).max(120), releaseYear: optionalYear, link: optionalUrl,
  })).max(40).default([]),
}).strict();
export type Details = z.infer<typeof detailsSchema>;

/** The columns of public_creators that come from the details form. */
export function detailColumns(d: Details) {
  return {
    fullName: d.fullName, creatorType: d.creatorType, experienceYears: d.experienceYears ?? null, bio: d.bio ?? null,
    imdbUrl: d.imdbUrl ?? null, showreelUrl: d.showreelUrl ?? null, otherLinks: d.otherLinks,
  };
}

export const creditRows = (creatorId: string, d: Details) =>
  d.credits.map((c) => ({ creatorId, projectTitle: c.projectTitle, credit: c.credit, releaseYear: c.releaseYear ?? null, link: c.link ?? null }));

export async function getMyProfile(db: Db, creatorId: string) {
  const [creator] = await db.select().from(publicCreators).where(eq(publicCreators.id, creatorId));
  if (!creator) throw notFound("Profile");
  const credits = await db.select().from(publicCreatorCredits).where(eq(publicCreatorCredits.creatorId, creatorId))
    .orderBy(desc(publicCreatorCredits.releaseYear), asc(publicCreatorCredits.createdAt));
  return { creator, credits };
}

/** Replaces the details and the whole list of credits in one go. The profile counts as complete once there is a photo. */
export async function saveMyProfile(db: Db, creatorId: string, raw: unknown): Promise<{ ok: true }> {
  const d = parseInput(detailsSchema, raw);
  await db.transaction(async (tx) => {
    const [cur] = await tx.select({ photo: publicCreators.profileImageKey, done: publicCreators.profileCompletedAt }).from(publicCreators).where(eq(publicCreators.id, creatorId));
    if (!cur) throw notFound("Profile");
    await tx.update(publicCreators).set({ ...detailColumns(d), profileCompletedAt: cur.done ?? (cur.photo ? new Date() : null) }).where(eq(publicCreators.id, creatorId));
    await tx.delete(publicCreatorCredits).where(eq(publicCreatorCredits.creatorId, creatorId));
    if (d.credits.length) await tx.insert(publicCreatorCredits).values(creditRows(creatorId, d));
  });
  return { ok: true };
}

/* ───────────── profile photo: the same quarantine → check-the-bytes → move flow every upload here uses ───────────── */
const photoIntentSchema = z.object({ filename: z.string().trim().min(1).max(255), sizeBytes: z.number().int().min(1) }).strict();
const photoCompleteSchema = z.object({ key: z.string().min(10).max(300) }).strict();

export async function createPhotoUpload(creatorId: string, storage: StoragePort, raw: unknown) {
  const input = parseInput(photoIntentSchema, raw);
  const ext = extensionOf(input.filename);
  if (!(ext in IMAGE_TYPES)) throw new AppError("VALIDATION", "Use a JPG, PNG or WEBP photo.", { filename: "Type not allowed" });
  if (input.sizeBytes > PHOTO_MAX_BYTES) throw new AppError("VALIDATION", "The photo must be under 8 MB.", { sizeBytes: "Too large" });
  const key = `public/${creatorId}/quarantine/photo-${randomUUID()}.${ext}`;
  const { url } = await storage.createSignedUploadUrl(key);
  return { key, uploadUrl: url };
}

export async function completePhoto(db: Db, creatorId: string, storage: StoragePort, raw: unknown, now = new Date()) {
  const { key } = parseInput(photoCompleteSchema, raw);
  // The browser names the object it uploaded; accept only one this writer's own intent could have produced.
  if (!new RegExp(`^public/${creatorId}/quarantine/photo-[0-9a-f-]{36}\\.(jpg|jpeg|png|webp)$`).test(key)) throw notFound("Photo");
  const bytes = await storage.download(key, PHOTO_MAX_BYTES).catch(() => null);
  if (!bytes) throw new AppError("VALIDATION", "The photo has not finished uploading.");
  const verdict = detectAndValidate(bytes, `photo.${key.slice(key.lastIndexOf(".") + 1)}`, IMAGE_TYPES);
  if (!verdict.ok) { await storage.remove([key]).catch(() => undefined); throw new AppError("VALIDATION", verdict.reason, { file: verdict.reason }); }
  const finalKey = `public/${creatorId}/photo/${createHash("sha256").update(bytes).digest("hex").slice(0, 16)}-${randomUUID()}.${verdict.type.ext}`;
  await storage.move(key, finalKey);
  const [old] = await db.select({ k: publicCreators.profileImageKey, done: publicCreators.profileCompletedAt }).from(publicCreators).where(eq(publicCreators.id, creatorId));
  await db.update(publicCreators).set({ profileImageKey: finalKey, profileCompletedAt: old?.done ?? now }).where(eq(publicCreators.id, creatorId));
  if (old?.k) await storage.remove([old.k]).catch(() => undefined);
  return { ok: true as const };
}

/** A short-lived link to the writer's own photo (what the <img> follows). */
export async function photoReadUrl(db: Db, creatorId: string, storage: StoragePort): Promise<string> {
  const [row] = await db.select({ k: publicCreators.profileImageKey }).from(publicCreators).where(eq(publicCreators.id, creatorId));
  if (!row?.k) throw notFound("Photo");
  const ext = row.k.slice(row.k.lastIndexOf(".") + 1).toLowerCase();
  return storage.createSignedReadUrl(row.k, SIGNED_URL_TTL_SECONDS(), undefined, { inline: true, contentType: IMAGE_TYPES[ext] ?? "image/jpeg" });
}
