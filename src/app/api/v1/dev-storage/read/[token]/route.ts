import { NextResponse, type NextRequest } from "next/server";
import { memoryStorageAllowed, getStorage } from "@/server/modules/storage";
import { MemoryStorage } from "@/server/modules/storage/memory";

/** Local development only: emulates signed read URLs for the in-memory adapter. */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const storage = memoryStorageAllowed() ? getStorage() : null;
  if (!(storage instanceof MemoryStorage)) return new NextResponse(null, { status: 404 });
  const r = storage.read((await params).token);
  if (!r) return new NextResponse(null, { status: 404 });
  const headers: Record<string, string> = { "Content-Type": r.contentType ?? "application/octet-stream", "X-Content-Type-Options": "nosniff", "Cache-Control": "no-store" };
  if (r.name !== undefined) headers["Content-Disposition"] = `${r.inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(r.name)}`;
  return new NextResponse(new Uint8Array(r.bytes), { headers });
}
