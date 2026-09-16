import { NextResponse, type NextRequest } from "next/server";
import { MAX_UPLOAD_BYTES, getStorage } from "@/server/modules/storage";
import { decodeDriveUploadToken, GoogleDriveStorage } from "@/server/modules/storage/drive";

/**
 * Relays a browser upload to the real Google Drive resumable-upload session, server-to-server.
 *
 * Google does not enable CORS on a resumable session created server-side (see the comment at the top of
 * drive.ts), so the browser cannot PUT directly to Drive's own URL the way it can with Supabase's signed
 * URLs. createSignedUploadUrl instead hands the browser a token naming this route; the token itself (HMAC-signed,
 * short-lived, single-purpose) is the one-time credential, exactly like the existing dev-storage upload route,
 * so this bypasses the normal session/CSRF-guarded route() wrapper on purpose.
 */
export async function PUT(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const storage = getStorage();
  if (!(storage instanceof GoogleDriveStorage)) return new NextResponse(null, { status: 404 });
  const decoded = decodeDriveUploadToken((await params).token);
  if (!decoded) return NextResponse.json({ error: "invalid or expired upload token" }, { status: 400 });

  const form = await req.formData().catch(() => null);
  const file = form?.get("") ?? form?.get("file");
  if (!(file instanceof Blob) || file.size === 0 || file.size > MAX_UPLOAD_BYTES()) {
    return NextResponse.json({ error: "bad upload" }, { status: 400 });
  }

  const res = await fetch(decoded.sessionUrl, {
    method: "PUT",
    headers: { "content-type": file.type || "application/octet-stream" },
    body: Buffer.from(await file.arrayBuffer()),
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) {
    // Not logged with full detail here (this route is unauthenticated, so keep the response generic); the
    // storage.download() call in the /complete step re-reads this same file and surfaces a real error there
    // if the relay actually failed to land.
    return NextResponse.json({ error: "drive upload failed" }, { status: 502 });
  }
  return NextResponse.json({ ok: true });
}
