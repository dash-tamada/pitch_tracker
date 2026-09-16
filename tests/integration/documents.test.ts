import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { auditLogs, documentAccessLogs, documentVersions } from "@/server/db/schema";
import {
  completeUpload, createUploadIntent, downloadVersion, listPitchDocuments, listPitchImages, pitchDownloadLog, setCurrentVersion,
} from "@/server/modules/documents/service";
import { MemoryStorage } from "@/server/modules/storage/memory";
import { performAction } from "@/server/modules/workflow/engine";
import { closeDb, makePitch, makeTeam, testDb } from "../helpers/db";
import { SAMPLE } from "../helpers/files";

const db = testDb();
const storage = new MemoryStorage();
let team: Awaited<ReturnType<typeof makeTeam>>;
let pitchId = "";
const code = async (p: Promise<unknown>) => { try { await p; return "OK"; } catch (e) { return (e as { code?: string }).code ?? String(e); } };

/** Simulates the browser: request intent → PUT bytes to the signed URL → complete. */
async function upload(user: typeof team.employeeA, body: Record<string, unknown>, bytes: Buffer) {
  const intent = await createUploadIntent(db, storage, user.actor, { sizeBytes: bytes.length, ...body });
  const token = intent.uploadUrl.split("/").pop()!;
  expect(storage.acceptUpload(token, bytes)).toBe(true);
  return completeUpload(db, storage, user.actor, intent.intentId, { ip: "10.1.1.1" });
}

beforeAll(async () => {
  team = await makeTeam(db);
  const p = await makePitch(db, team.employeeA);
  pitchId = p.id;
});
afterAll(closeDb);

describe("script versioning", () => {
  it("never overwrites: V1, V2 are separate immutable versions and the newest becomes current", async () => {
    const v1 = await upload(team.employeeA, { kind: "DOCUMENT", pitchId, categoryKey: "SCRIPT", title: "Script", filename: "last-journey-v1.pdf" }, SAMPLE.pdf());
    expect(v1).toMatchObject({ kind: "DOCUMENT", versionNo: 1 });
    const v2 = await upload(team.employeeA, { kind: "DOCUMENT", pitchId, categoryKey: "SCRIPT", documentId: (v1 as { documentId: string }).documentId,
      filename: "last-journey-v2.docx", versionLabel: "Second draft for Netflix" }, SAMPLE.docx());
    expect(v2).toMatchObject({ versionNo: 2 });
    const docs = await listPitchDocuments(db, team.employeeA.actor, pitchId);
    expect(docs).toHaveLength(1);
    expect(docs[0]!.versions.map((v) => [v.versionNo, v.isCurrent, v.scanStatus])).toEqual([[2, true, "NOT_SCANNED"], [1, false, "NOT_SCANNED"]]);
    // storage keys are server-generated; the user's filename is display-only
    const [row] = await db.select().from(documentVersions).where(eq(documentVersions.versionNo, 1));
    expect(row!.storageKey).toMatch(/^company\/aaaaaaaa-0000-4000-8000-00000000000a\/pitches\/[0-9a-f-]{36}\/documents\/[0-9a-f-]{36}\.pdf$/);
    expect(row!.sha256).toMatch(/^[0-9a-f]{64}$/);
    // the database refuses edits to a version row
    await expect(db.update(documentVersions).set({ storageKey: "evil" }).where(eq(documentVersions.id, row!.id))).rejects.toThrow();
    // current version can be switched back, audited
    await setCurrentVersion(db, team.employeeA.actor, docs[0]!.id, row!.id);
    expect((await listPitchDocuments(db, team.employeeA.actor, pitchId))[0]!.versions.find((v) => v.versionNo === 1)!.isCurrent).toBe(true);
  });

  it("rejects disguised and macro files, removes them from quarantine and logs the rejection", async () => {
    expect(await code(upload(team.employeeA, { kind: "DOCUMENT", pitchId, categoryKey: "SCRIPT", title: "Bad", filename: "script.pdf" }, SAMPLE.exeAsPdf()))).toBe("VALIDATION");
    expect(await code(upload(team.employeeA, { kind: "DOCUMENT", pitchId, categoryKey: "SCRIPT", title: "Macro", filename: "script.docx" }, SAMPLE.docxWithMacro()))).toBe("VALIDATION");
    expect([...storage.objects.keys()].filter((k) => k.startsWith("quarantine/"))).toEqual([]);
    const rejected = await db.select().from(auditLogs).where(eq(auditLogs.action, "upload.rejected"));
    expect(rejected.length).toBe(2);
  });

  it("refuses disallowed extensions and oversize files before issuing an upload URL", async () => {
    expect(await code(createUploadIntent(db, storage, team.employeeA.actor, { kind: "DOCUMENT", pitchId, categoryKey: "SCRIPT", title: "x", filename: "x.svg", sizeBytes: 10 }))).toBe("VALIDATION");
    expect(await code(createUploadIntent(db, storage, team.employeeA.actor, { kind: "DOCUMENT", pitchId, categoryKey: "SCRIPT", title: "x", filename: "x.pdf", sizeBytes: 500 * 1024 * 1024 }))).toBe("VALIDATION");
    expect(await code(createUploadIntent(db, storage, team.employeeA.actor, { kind: "DOCUMENT", pitchId, categoryKey: "NOT_A_CATEGORY", title: "x", filename: "x.pdf", sizeBytes: 10 }))).toBe("VALIDATION");
  });

  it("an upload intent can only be completed by the user who created it, once", async () => {
    const bytes = SAMPLE.pdf();
    const intent = await createUploadIntent(db, storage, team.employeeA.actor, { kind: "DOCUMENT", pitchId, categoryKey: "SYNOPSIS", title: "Synopsis", filename: "s.pdf", sizeBytes: bytes.length });
    storage.acceptUpload(intent.uploadUrl.split("/").pop()!, bytes);
    expect(await code(completeUpload(db, storage, team.employeeB.actor, intent.intentId))).toBe("NOT_FOUND");
    expect(await code(completeUpload(db, storage, team.employeeA.actor, intent.intentId))).toBe("OK");
    expect(await code(completeUpload(db, storage, team.employeeA.actor, intent.intentId))).toBe("CONFLICT");
  });
});

describe("confidential downloads", () => {
  it("uninvolved employees cannot list, upload to or download from a pitch (IDOR)", async () => {
    const [doc] = await listPitchDocuments(db, team.employeeA.actor, pitchId);
    const versionId = doc!.versions[0]!.id;
    expect(await code(listPitchDocuments(db, team.outsider.actor, pitchId))).toBe("NOT_FOUND");
    expect(await code(downloadVersion(db, storage, team.outsider.actor, versionId))).toBe("NOT_FOUND");
    expect(await code(createUploadIntent(db, storage, team.outsider.actor, { kind: "DOCUMENT", pitchId, categoryKey: "SCRIPT", title: "x", filename: "x.pdf", sizeBytes: 10 }))).toBe("NOT_FOUND");
    expect(await code(downloadVersion(db, storage, team.admin.actor, versionId))).toBe("FORBIDDEN"); // Admin has no document.download
    expect(await code(downloadVersion(db, storage, team.viewer.actor, versionId))).toBe("FORBIDDEN");
  });

  it("every download is logged with who/when/version and returns a short-lived attachment URL", async () => {
    const [doc] = await listPitchDocuments(db, team.employeeA.actor, pitchId);
    const v = doc!.versions.find((x) => x.versionNo === 2)!;
    // Employee B gets access once the pitch is forwarded to them
    await performAction(db, team.employeeA.actor, pitchId, { action: "ASSIGN", expectedVersion: 1, recipientId: team.employeeA.id });
    await performAction(db, team.employeeA.actor, pitchId, { action: "FORWARD", expectedVersion: 2, toStageKey: "INTERNAL_REVIEW", recipientId: team.employeeB.id, remarks: "Read V2" });
    const url = await downloadVersion(db, storage, team.employeeB.actor, v.id, { ip: "10.2.2.2", userAgent: "vitest" });
    expect(url).toMatch(/^\/api\/v1\/dev-storage\/read\//);
    expect(storage.read(url.split("/").pop()!)).toMatchObject({ name: "last-journey-v2.docx" });
    const logs = await db.select().from(documentAccessLogs).where(eq(documentAccessLogs.documentVersionId, v.id));
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ userId: team.employeeB.id, action: "DOWNLOAD", ip: "10.2.2.2" });
    const log = await pitchDownloadLog(db, team.senior.actor, pitchId);
    expect(log[0]).toMatchObject({ userName: "Employee B", versionNo: 2, title: "Script" });
    expect(await code(pitchDownloadLog(db, team.employeeA.actor, pitchId))).toBe("FORBIDDEN");
  });
});

describe("images", () => {
  it("accepts real images only and serves them through signed URLs", async () => {
    await upload(team.employeeA, { kind: "IMAGE", pitchId, categoryKey: "MOOD_BOARD", caption: "Dawn yard", filename: "mood.png" }, SAMPLE.png());
    expect(await code(upload(team.employeeA, { kind: "IMAGE", pitchId, categoryKey: "POSTER", filename: "poster.png" }, SAMPLE.pdf()))).toBe("VALIDATION");
    const imgs = await listPitchImages(db, storage, team.employeeA.actor, pitchId);
    expect(imgs).toHaveLength(1);
    expect(imgs[0]!.url).toMatch(/^\/api\/v1\/dev-storage\/read\//);
  });
});
