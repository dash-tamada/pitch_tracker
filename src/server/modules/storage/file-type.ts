/**
 * Content-based file type detection. The browser-supplied MIME type and extension are never trusted on their own:
 * the extension must be on the allowlist AND the bytes must match that type.
 */

export type DetectedType = { mime: string; ext: string };

export const DOCUMENT_TYPES: Record<string, string> = {
  pdf: "application/pdf", doc: "application/msword", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  txt: "text/plain", ppt: "application/vnd.ms-powerpoint", pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp",
};
export const IMAGE_TYPES: Record<string, string> = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp" };

export function extensionOf(filename: string): string {
  const m = /\.([a-z0-9]{1,5})$/i.exec(filename.trim());
  return m ? m[1]!.toLowerCase() : "";
}

const CONTROL_OR_RESERVED = /[\p{Cc}"<>:|?*]/gu;

/** Keeps a readable name for display/download: strips paths, control chars and reserved characters. */
export function sanitizeFilename(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "file";
  const cleaned = base.normalize("NFKC").replace(CONTROL_OR_RESERVED, "").replace(/\s+/g, " ").trim().replace(/^\.+/, "");
  return (cleaned || "file").slice(0, 200);
}

const startsWith = (b: Buffer, sig: number[], offset = 0) => sig.every((v, i) => b[offset + i] === v);

/** Minimal ZIP central-directory reader: returns entry names (enough to tell DOCX/PPTX apart and spot macros). */
export function zipEntryNames(b: Buffer): string[] | null {
  if (b.length < 22) return null;
  const min = Math.max(0, b.length - 65_557);
  let eocd = -1;
  for (let i = b.length - 22; i >= min; i--) if (b.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) return null;
  const count = b.readUInt16LE(eocd + 10);
  let p = b.readUInt32LE(eocd + 16);
  const names: string[] = [];
  for (let i = 0; i < count && i < 5000; i++) {
    if (p + 46 > b.length || b.readUInt32LE(p) !== 0x02014b50) return null;
    const nameLen = b.readUInt16LE(p + 28), extraLen = b.readUInt16LE(p + 30), commentLen = b.readUInt16LE(p + 32);
    if (p + 46 + nameLen > b.length) return null;
    names.push(b.subarray(p + 46, p + 46 + nameLen).toString("utf8"));
    p += 46 + nameLen + extraLen + commentLen;
  }
  return names;
}

export type Verdict = { ok: true; type: DetectedType } | { ok: false; reason: string };

export function detectAndValidate(bytes: Buffer, filename: string, allowed: Record<string, string>): Verdict {
  const ext = extensionOf(filename);
  if (!ext || !(ext in allowed)) return { ok: false, reason: "File type not allowed." };
  if (bytes.length === 0) return { ok: false, reason: "File is empty." };
  const expected = allowed[ext]!;
  const fail = (reason = "File contents do not match its extension.") => ({ ok: false as const, reason });

  switch (ext) {
    case "pdf":
      if (!startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) return fail();
      break;
    case "jpg": case "jpeg":
      if (!startsWith(bytes, [0xff, 0xd8, 0xff])) return fail();
      break;
    case "png":
      if (!startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return fail();
      break;
    case "webp":
      if (!startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) || !startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8)) return fail();
      break;
    case "doc": case "ppt":
      // OLE2 compound file. Legacy formats can carry macros that are not inspected here (recorded as NOT_SCANNED).
      if (!startsWith(bytes, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) return fail();
      break;
    case "docx": case "pptx": {
      if (!startsWith(bytes, [0x50, 0x4b, 0x03, 0x04])) return fail();
      const names = zipEntryNames(bytes);
      if (!names) return fail("Document archive is damaged.");
      if (!names.includes("[Content_Types].xml")) return fail();
      const root = ext === "docx" ? "word/" : "ppt/";
      if (!names.some((n) => n.startsWith(root))) return fail();
      if (names.some((n) => /vbaProject\.bin$/i.test(n) || /vbaData\.xml$/i.test(n))) return fail("Documents containing macros are not allowed.");
      if (names.length > 4000) return fail("Document archive has too many entries.");
      break;
    }
    case "txt": {
      if (bytes.includes(0)) return fail("Text file contains binary data.");
      try { new TextDecoder("utf-8", { fatal: true }).decode(bytes); } catch { return fail("Text file must be UTF-8."); }
      break;
    }
    default:
      return fail("File type not allowed.");
  }
  return { ok: true, type: { mime: expected, ext } };
}
