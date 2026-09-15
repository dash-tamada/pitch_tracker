import { NextResponse, type NextRequest } from "next/server";
import { memoryStorageAllowed, getStorage, MAX_UPLOAD_BYTES } from "@/server/modules/storage";
import { MemoryStorage } from "@/server/modules/storage/memory";

/** Local development only: emulates the storage provider's signed-upload endpoint for the in-memory adapter. */
export async function PUT(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const storage = memoryStorageAllowed() ? getStorage() : null;
  if (!(storage instanceof MemoryStorage)) return new NextResponse(null, { status: 404 });
  const { token } = await params;
  const form = await req.formData().catch(() => null);
  const file = form?.get("") ?? form?.get("file");
  if (!(file instanceof Blob) || file.size > MAX_UPLOAD_BYTES()) return NextResponse.json({ error: "bad upload" }, { status: 400 });
  const ok = storage.acceptUpload(token, Buffer.from(await file.arrayBuffer()));
  return ok ? NextResponse.json({ Key: "ok" }) : NextResponse.json({ error: "invalid token" }, { status: 400 });
}
