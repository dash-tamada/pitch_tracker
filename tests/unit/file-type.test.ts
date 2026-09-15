import { describe, expect, it } from "vitest";
import { DOCUMENT_TYPES, IMAGE_TYPES, detectAndValidate, sanitizeFilename } from "@/server/modules/storage/file-type";
import { SAMPLE } from "../helpers/files";

const ok = (b: Buffer, n: string, allowed = DOCUMENT_TYPES) => detectAndValidate(b, n, allowed);

describe("content-based file validation", () => {
  it.each([["script.pdf", SAMPLE.pdf()], ["script.docx", SAMPLE.docx()], ["deck.pptx", SAMPLE.pptx()], ["poster.png", SAMPLE.png()],
    ["still.JPG", SAMPLE.jpg()], ["mood.webp", SAMPLE.webp()], ["old.doc", SAMPLE.doc()], ["notes.txt", SAMPLE.txt()]])("accepts real %s", (name, bytes) => {
    expect(ok(bytes, name).ok).toBe(true);
  });
  it("rejects an executable renamed to .pdf", () => expect(ok(SAMPLE.exeAsPdf(), "script.pdf")).toEqual({ ok: false, reason: "File contents do not match its extension." }));
  it("rejects a PNG renamed to .docx and a DOCX renamed to .pptx", () => {
    expect(ok(SAMPLE.png(), "script.docx").ok).toBe(false);
    expect(ok(SAMPLE.docx(), "deck.pptx").ok).toBe(false);
  });
  it("rejects macro-enabled Office documents", () => expect(ok(SAMPLE.docxWithMacro(), "script.docx")).toEqual({ ok: false, reason: "Documents containing macros are not allowed." }));
  it("rejects disallowed types regardless of content: html, svg, exe, zip, js", () => {
    for (const n of ["x.html", "x.svg", "x.exe", "x.zip", "x.js", "x", "x.pdf.exe"]) expect(ok(SAMPLE.html(), n).ok, n).toBe(false);
  });
  it("rejects binary data in .txt and non-image in image-only uploads", () => {
    expect(ok(Buffer.from([0x41, 0x00, 0x42]), "a.txt").ok).toBe(false);
    expect(detectAndValidate(SAMPLE.pdf(), "poster.pdf", IMAGE_TYPES).ok).toBe(false);
  });
  it("rejects empty files", () => expect(ok(Buffer.alloc(0), "a.pdf").ok).toBe(false));
  it("sanitizes filenames: no paths, control characters or reserved characters", () => {
    expect(sanitizeFilename("../../etc/passwd")).toBe("passwd");
    expect(sanitizeFilename("C:\\Users\\x\\Script\u0000V2<>.pdf")).toBe("ScriptV2.pdf");
    expect(sanitizeFilename("...hidden.pdf")).toBe("hidden.pdf");
    expect(sanitizeFilename('a"b|c?.pdf')).toBe("abc.pdf");
  });
});
