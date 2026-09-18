/** Creator portal document upload: quarantine-and-validate flow, rejected-pitch block, and cross-creator/company isolation. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID, createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { documentVersions, pitches } from "@/server/db/schema";
import { registerCreator } from "@/server/modules/creator-portal/auth";
import { completeCreatorUpload, createCreatorUploadIntent, getMyDownloadUrl, getMyViewUrl, listMyPitchDocuments } from "@/server/modules/creator-portal/documents";
import { submitCreatorPitch } from "@/server/modules/creator-portal/pitch";
import { MemoryStorage } from "@/server/modules/storage/memory";
import { closeDb, COMPANY_A, COMPANY_B, makePortalLink, testDb } from "../helpers/db";

const errCode = async (p: Promise<unknown>) => { try { await p; return "OK"; } catch (e) { return (e as { code?: string }).code ?? String(e); } };
const storage = new MemoryStorage();

let tokenA: string;
let tokenB: string;
let creatorA1: { creatorId: string; companyId: string };
let creatorA2: { creatorId: string; companyId: string };
let creatorB1: { creatorId: string; companyId: string };

async function newPitch(companyId: string, creatorId: string) {
  const r = await submitCreatorPitch(companyId, creatorId, {
    title: "The Last Journey", formatKey: "FEATURE_FILM", languageKey: "TELUGU", genreKey: "THRILLER", episodeDurationMin: 100,
  });
  return r.pitchId;
}

async function uploadTxt(companyId: string, creatorId: string, pitchId: string, text = "screenplay draft one") {
  const bytes = Buffer.from(text, "utf-8");
  const intent = await createCreatorUploadIntent(companyId, creatorId, storage, {
    pitchId, categoryKey: "SCRIPT", title: "Draft One", filename: "draft.txt", sizeBytes: bytes.length,
  });
  const token = intent.uploadUrl.split("/").pop()!;
  storage.acceptUpload(token, bytes);
  return completeCreatorUpload(companyId, creatorId, storage, intent.intentId);
}

/**
 * document_versions_guard (0002_supabase_hardening.sql) only allows scan_status to change FROM 'PENDING',
 * and completeCreatorUpload always inserts NOT_SCANNED — so an UPDATE can never get a version into
 * PENDING/INFECTED/FAILED for a test. Insert the row directly instead (the guard trigger fires on
 * UPDATE/DELETE only, never INSERT), on the same document an ordinary upload already created.
 */
let scanTestVersionNo = 900;
async function insertVersionWithScanStatus(companyId: string, creatorId: string, documentId: string, scanStatus: "PENDING" | "INFECTED" | "FAILED") {
  const bytes = Buffer.from("a version stuck in scanning", "utf-8");
  const versionId = randomUUID();
  await testDb(companyId).insert(documentVersions).values({
    id: versionId, documentId, versionNo: scanTestVersionNo++, storageKey: `company/${companyId}/pitches/x/documents/${versionId}.txt`,
    originalFilename: "blocked.txt", detectedMime: "text/plain", sizeBytes: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"), scanStatus, uploadedByCreatorId: creatorId,
  });
  return versionId;
}

beforeAll(async () => {
  tokenA = await makePortalLink(COMPANY_A);
  tokenB = await makePortalLink(COMPANY_B);
  creatorA1 = await registerCreator({ token: tokenA, creatorType: "WRITER", fullName: "Doc Creator A1", email: `dc.a1.${Date.now()}@example.test`, password: "correct horse battery staple 9" });
  creatorA2 = await registerCreator({ token: tokenA, creatorType: "WRITER", fullName: "Doc Creator A2", email: `dc.a2.${Date.now()}@example.test`, password: "correct horse battery staple 9" });
  creatorB1 = await registerCreator({ token: tokenB, creatorType: "WRITER", fullName: "Doc Creator B1", email: `dc.b1.${Date.now()}@example.test`, password: "correct horse battery staple 9" });
});
afterAll(closeDb);

describe("creator portal document upload", () => {
  it("uploads a first document, creating both the document and its first version", async () => {
    const pitchId = await newPitch(creatorA1.companyId, creatorA1.creatorId);
    const r = await uploadTxt(creatorA1.companyId, creatorA1.creatorId, pitchId);
    expect(r.versionNo).toBe(1);
    const docs = await listMyPitchDocuments(creatorA1.companyId, creatorA1.creatorId, pitchId);
    expect(docs).toHaveLength(1);
    expect(docs[0]!.versions).toHaveLength(1);
    expect(docs[0]!.versions[0]!.originalFilename).toBe("draft.txt");
  });

  it("uploads a second version of the same document when documentId is given", async () => {
    const pitchId = await newPitch(creatorA1.companyId, creatorA1.creatorId);
    const first = await uploadTxt(creatorA1.companyId, creatorA1.creatorId, pitchId, "draft one");
    const bytes = Buffer.from("draft two, revised", "utf-8");
    const intent = await createCreatorUploadIntent(creatorA1.companyId, creatorA1.creatorId, storage, {
      pitchId, categoryKey: "SCRIPT", documentId: first.documentId, filename: "draft2.txt", sizeBytes: bytes.length,
    });
    const token = intent.uploadUrl.split("/").pop()!;
    storage.acceptUpload(token, bytes);
    const second = await completeCreatorUpload(creatorA1.companyId, creatorA1.creatorId, storage, intent.intentId);
    expect(second.documentId).toBe(first.documentId);
    expect(second.versionNo).toBe(2);
    const docs = await listMyPitchDocuments(creatorA1.companyId, creatorA1.creatorId, pitchId);
    expect(docs).toHaveLength(1);
    expect(docs[0]!.versions).toHaveLength(2);
  });

  it("rejects a file whose content does not match its declared extension", async () => {
    const pitchId = await newPitch(creatorA1.companyId, creatorA1.creatorId);
    const bytes = Buffer.from("not actually a pdf", "utf-8");
    const intent = await createCreatorUploadIntent(creatorA1.companyId, creatorA1.creatorId, storage, {
      pitchId, categoryKey: "SCRIPT", title: "Fake PDF", filename: "script.pdf", sizeBytes: bytes.length,
    });
    const token = intent.uploadUrl.split("/").pop()!;
    storage.acceptUpload(token, bytes);
    expect(await errCode(completeCreatorUpload(creatorA1.companyId, creatorA1.creatorId, storage, intent.intentId))).toBe("VALIDATION");
  });

  it("rejects an upload intent for a file type not on the document allowlist", async () => {
    const pitchId = await newPitch(creatorA1.companyId, creatorA1.creatorId);
    expect(await errCode(createCreatorUploadIntent(creatorA1.companyId, creatorA1.creatorId, storage, {
      pitchId, categoryKey: "SCRIPT", title: "Bad type", filename: "malware.exe", sizeBytes: 10,
    }))).toBe("VALIDATION");
  });

  it("blocks creating an upload intent against a rejected pitch", async () => {
    const pitchId = await newPitch(creatorA1.companyId, creatorA1.creatorId);
    // Move the pitch to REJECTED directly as staff (creators can never do this themselves — no UPDATE grant on pitches).
    await testDb(COMPANY_A).update(pitches).set({ currentStageKey: "REJECTED" }).where(eq(pitches.id, pitchId));
    expect(await errCode(createCreatorUploadIntent(creatorA1.companyId, creatorA1.creatorId, storage, {
      pitchId, categoryKey: "SCRIPT", title: "Too late", filename: "draft.txt", sizeBytes: 5,
    }))).toBe("VALIDATION");
  });

  it("blocks completing an upload if the pitch was rejected after the intent was created", async () => {
    const pitchId = await newPitch(creatorA1.companyId, creatorA1.creatorId);
    const bytes = Buffer.from("in flight when rejected", "utf-8");
    const intent = await createCreatorUploadIntent(creatorA1.companyId, creatorA1.creatorId, storage, {
      pitchId, categoryKey: "SCRIPT", title: "In flight", filename: "draft.txt", sizeBytes: bytes.length,
    });
    const token = intent.uploadUrl.split("/").pop()!;
    storage.acceptUpload(token, bytes);
    await testDb(COMPANY_A).update(pitches).set({ currentStageKey: "REJECTED" }).where(eq(pitches.id, pitchId));
    expect(await errCode(completeCreatorUpload(creatorA1.companyId, creatorA1.creatorId, storage, intent.intentId))).toBe("VALIDATION");
  });

  it("never lets a creator create an upload intent against a teammate's pitch", async () => {
    const pitchId = await newPitch(creatorA1.companyId, creatorA1.creatorId);
    expect(await errCode(createCreatorUploadIntent(creatorA2.companyId, creatorA2.creatorId, storage, {
      pitchId, categoryKey: "SCRIPT", title: "Not mine", filename: "draft.txt", sizeBytes: 5,
    }))).toBe("NOT_FOUND");
  });

  it("never lets a creator in a different company touch another company's pitch", async () => {
    const pitchId = await newPitch(creatorA1.companyId, creatorA1.creatorId);
    expect(await errCode(createCreatorUploadIntent(creatorB1.companyId, creatorB1.creatorId, storage, {
      pitchId, categoryKey: "SCRIPT", title: "Cross company", filename: "draft.txt", sizeBytes: 5,
    }))).toBe("NOT_FOUND");
  });

  it("never lets a creator complete another creator's upload intent", async () => {
    const pitchId = await newPitch(creatorA1.companyId, creatorA1.creatorId);
    const bytes = Buffer.from("mine, not yours", "utf-8");
    const intent = await createCreatorUploadIntent(creatorA1.companyId, creatorA1.creatorId, storage, {
      pitchId, categoryKey: "SCRIPT", title: "Mine", filename: "draft.txt", sizeBytes: bytes.length,
    });
    const token = intent.uploadUrl.split("/").pop()!;
    storage.acceptUpload(token, bytes);
    expect(await errCode(completeCreatorUpload(creatorA2.companyId, creatorA2.creatorId, storage, intent.intentId))).toBe("NOT_FOUND");
  });

  it("hides another creator's pitch documents from listMyPitchDocuments as NOT_FOUND", async () => {
    const pitchId = await newPitch(creatorA1.companyId, creatorA1.creatorId);
    await uploadTxt(creatorA1.companyId, creatorA1.creatorId, pitchId);
    expect(await errCode(listMyPitchDocuments(creatorA2.companyId, creatorA2.creatorId, pitchId))).toBe("NOT_FOUND");
  });

  it("requires a title for a brand-new document but not when adding a version to an existing one", async () => {
    const pitchId = await newPitch(creatorA1.companyId, creatorA1.creatorId);
    expect(await errCode(createCreatorUploadIntent(creatorA1.companyId, creatorA1.creatorId, storage, {
      pitchId, categoryKey: "SCRIPT", filename: "draft.txt", sizeBytes: 5,
    }))).toBe("VALIDATION");
  });
});

// getMyDownloadUrl/getMyViewUrl are new: a creator viewing/downloading their OWN upload. The RLS
// (creator_own_document_versions) and the documentAccessLogs.creatorId column already existed for this;
// only the application code was missing. Same IDOR/BOLA isolation the upload path already gets, verified
// the same way as the tests above.
describe("creator viewing/downloading their own uploaded document", () => {
  it("returns a working signed URL for both view and download, and force-attaches (never inlines) the download", async () => {
    const pitchId = await newPitch(creatorA1.companyId, creatorA1.creatorId);
    const { versionId } = await uploadTxt(creatorA1.companyId, creatorA1.creatorId, pitchId, "my own screenplay draft");

    const downloadUrl = await getMyDownloadUrl(creatorA1.companyId, creatorA1.creatorId, versionId, storage);
    expect(storage.read(downloadUrl.split("/").pop()!)).toMatchObject({ name: "draft.txt" });
    expect(storage.read(downloadUrl.split("/").pop()!)!.inline).toBeFalsy();

    const { url: viewUrl, mime, filename } = await getMyViewUrl(creatorA1.companyId, creatorA1.creatorId, versionId, storage);
    expect(mime).toBe("text/plain");
    expect(filename).toBe("draft.txt");
    expect(storage.read(viewUrl.split("/").pop()!)).toMatchObject({ name: "draft.txt", inline: true });
  });

  it("never lets a creator view or download a teammate's upload (IDOR)", async () => {
    const pitchId = await newPitch(creatorA1.companyId, creatorA1.creatorId);
    const { versionId } = await uploadTxt(creatorA1.companyId, creatorA1.creatorId, pitchId);
    expect(await errCode(getMyDownloadUrl(creatorA2.companyId, creatorA2.creatorId, versionId, storage))).toBe("NOT_FOUND");
    expect(await errCode(getMyViewUrl(creatorA2.companyId, creatorA2.creatorId, versionId, storage))).toBe("NOT_FOUND");
  });

  it("never lets a creator in a different company view or download another company's upload (IDOR)", async () => {
    const pitchId = await newPitch(creatorA1.companyId, creatorA1.creatorId);
    const { versionId } = await uploadTxt(creatorA1.companyId, creatorA1.creatorId, pitchId);
    expect(await errCode(getMyDownloadUrl(creatorB1.companyId, creatorB1.creatorId, versionId, storage))).toBe("NOT_FOUND");
    expect(await errCode(getMyViewUrl(creatorB1.companyId, creatorB1.creatorId, versionId, storage))).toBe("NOT_FOUND");
  });

  it("blocks view/download of a version that has not cleared its security scan", async () => {
    const pitchId = await newPitch(creatorA1.companyId, creatorA1.creatorId);
    const { documentId } = await uploadTxt(creatorA1.companyId, creatorA1.creatorId, pitchId);
    const pendingId = await insertVersionWithScanStatus(creatorA1.companyId, creatorA1.creatorId, documentId, "PENDING");
    expect(await errCode(getMyDownloadUrl(creatorA1.companyId, creatorA1.creatorId, pendingId, storage))).toBe("FORBIDDEN");
    expect(await errCode(getMyViewUrl(creatorA1.companyId, creatorA1.creatorId, pendingId, storage))).toBe("FORBIDDEN");
    const infectedId = await insertVersionWithScanStatus(creatorA1.companyId, creatorA1.creatorId, documentId, "INFECTED");
    expect(await errCode(getMyDownloadUrl(creatorA1.companyId, creatorA1.creatorId, infectedId, storage))).toBe("FORBIDDEN");
  });
});
