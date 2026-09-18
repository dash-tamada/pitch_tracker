/** Company logo upload: quarantine-and-validate flow (mirrors documents/service.ts, self-contained — see
 *  tenancy/company.ts's own comment on why), company.manage authorization, and cross-company key isolation. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { completeLogoUpload, createLogoUploadUrl, companyBranding, companyLogoUrl, removeCompanyLogo } from "@/server/modules/tenancy/company";
import { MemoryStorage } from "@/server/modules/storage/memory";
import { closeDb, COMPANY_A, COMPANY_B, makeUser, testDb } from "../helpers/db";
import { SAMPLE } from "../helpers/files";

const db = testDb(COMPANY_A);
const dbB = testDb(COMPANY_B);
const storage = new MemoryStorage();
const errCode = async (p: Promise<unknown>) => { try { await p; return "OK"; } catch (e) { return (e as { code?: string }).code ?? String(e); } };

let admin: Awaited<ReturnType<typeof makeUser>>;
let employee: Awaited<ReturnType<typeof makeUser>>;

async function upload(bytes = SAMPLE.png(), filename = "logo.png") {
  const intent = await createLogoUploadUrl(db, admin.actor, storage, { filename, sizeBytes: bytes.length });
  expect(storage.acceptUpload(intent.uploadUrl.split("/").pop()!, bytes)).toBe(true);
  await completeLogoUpload(db, admin.actor, storage, { quarantineKey: intent.quarantineKey, filename, sizeBytes: bytes.length });
  return intent;
}

beforeAll(async () => {
  admin = await makeUser(db, "Company Admin", ["COMPANY_ADMIN"]);
  employee = await makeUser(db, "Employee", ["EMPLOYEE"]);
});
afterAll(closeDb);

describe("company logo", () => {
  it("uploads a logo, exposes it via companyBranding + companyLogoUrl, and replacing it removes the old object", async () => {
    const first = await upload();
    const brand = await companyBranding(db);
    expect(brand!.logoKey).toMatch(new RegExp(`^company/${COMPANY_A}/logo/logo-[0-9a-f-]{36}\\.png$`));
    const url = await companyLogoUrl(db, storage, brand!.logoKey);
    expect(url).toMatch(/^\/api\/v1\/dev-storage\/read\//);
    expect(storage.read(url!.split("/").pop()!)).toMatchObject({ inline: true });
    expect(storage.objects.has(first.quarantineKey)).toBe(false); // moved out of quarantine

    const oldKey = brand!.logoKey;
    await upload(SAMPLE.png(), "logo2.png");
    const brand2 = await companyBranding(db);
    expect(brand2!.logoKey).not.toBe(oldKey);
    expect(storage.objects.has(oldKey!)).toBe(false); // old logo deleted on replace
  });

  it("rejects a file whose content does not match its declared extension", async () => {
    const bytes = Buffer.from("not actually a png", "utf-8");
    const intent = await createLogoUploadUrl(db, admin.actor, storage, { filename: "fake.png", sizeBytes: bytes.length });
    storage.acceptUpload(intent.uploadUrl.split("/").pop()!, bytes);
    expect(await errCode(completeLogoUpload(db, admin.actor, storage, { quarantineKey: intent.quarantineKey, filename: "fake.png", sizeBytes: bytes.length }))).toBe("VALIDATION");
    expect(storage.objects.has(intent.quarantineKey)).toBe(false); // rejected upload cleaned out of quarantine
  });

  it("rejects a non-image extension before issuing an upload URL", async () => {
    expect(await errCode(createLogoUploadUrl(db, admin.actor, storage, { filename: "logo.pdf", sizeBytes: 10 }))).toBe("VALIDATION");
  });

  it("requires company.manage — an Admin (not Company Admin) cannot upload or remove the logo", async () => {
    expect(await errCode(createLogoUploadUrl(db, employee.actor, storage, { filename: "logo.png", sizeBytes: 10 }))).toBe("FORBIDDEN");
    expect(await errCode(completeLogoUpload(db, employee.actor, storage, { quarantineKey: "x", filename: "logo.png", sizeBytes: 10 }))).toBe("FORBIDDEN");
    expect(await errCode(removeCompanyLogo(db, employee.actor, storage))).toBe("FORBIDDEN");
  });

  it("never lets a completeLogoUpload call move an object from another company's quarantine path", async () => {
    const foreignKey = `company/${COMPANY_B}/logo/quarantine/${crypto.randomUUID()}.png`;
    storage.put(foreignKey, SAMPLE.png());
    expect(await errCode(completeLogoUpload(db, admin.actor, storage, { quarantineKey: foreignKey, filename: "logo.png", sizeBytes: 10 }))).toBe("VALIDATION");
    expect(storage.objects.has(foreignKey)).toBe(true); // left untouched
  });

  it("removeCompanyLogo clears the key and deletes the object; is a harmless no-op when there is none", async () => {
    await upload();
    const before = await companyBranding(db);
    expect(before!.logoKey).not.toBeNull();
    await removeCompanyLogo(db, admin.actor, storage);
    const after = await companyBranding(db);
    expect(after!.logoKey).toBeNull();
    expect(storage.objects.has(before!.logoKey!)).toBe(false);
    await expect(removeCompanyLogo(db, admin.actor, storage)).resolves.toEqual({ ok: true });
  });
});
