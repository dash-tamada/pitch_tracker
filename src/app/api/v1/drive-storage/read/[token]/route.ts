import { NextResponse, type NextRequest } from "next/server";
import { MAX_UPLOAD_BYTES, getStorage } from "@/server/modules/storage";
import { decodeDriveReadToken, GoogleDriveStorage } from "@/server/modules/storage/drive";

/**
 * Proxies a Drive-stored file's bytes through our own server for the short window the token is valid.
 * The Drive service account's credentials never reach the browser; the token names only a file id and an
 * expiry, HMAC-signed (see auth/tokens.ts) so any server instance can verify it without shared state.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const storage = getStorage();
  if (!(storage instanceof GoogleDriveStorage)) return new NextResponse(null, { status: 404 });
  const decoded = decodeDriveReadToken((await params).token);
  if (!decoded) return new NextResponse(null, { status: 404 });
  let bytes: Buffer;
  try {
    bytes = await storage.downloadById(decoded.fileId, MAX_UPLOAD_BYTES());
  } catch {
    return new NextResponse(null, { status: 404 });
  }
  const headers: Record<string, string> = { "Content-Type": decoded.contentType ?? "application/octet-stream", "X-Content-Type-Options": "nosniff", "Cache-Control": "no-store" };
  if (decoded.downloadName) {
    const disposition = decoded.inline ? "inline" : "attachment";
    headers["Content-Disposition"] = `${disposition}; filename*=UTF-8''${encodeURIComponent(decoded.downloadName)}`;
  }
  return new NextResponse(new Uint8Array(bytes), { headers });
}
