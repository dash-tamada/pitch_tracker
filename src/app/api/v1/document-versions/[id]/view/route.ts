import { NextResponse } from "next/server";
import { getDb } from "@/server/db/client";
import { route, uuidParam } from "@/server/lib/http";
import { viewVersion } from "@/server/modules/documents/service";
import { getStorage } from "@/server/modules/storage";

/**
 * Same access checks and logging as /download, but returns the inline preview URL as JSON (never a redirect):
 * the raw file must never be navigated to directly, or the browser's own PDF/image viewer takes over with its
 * full native chrome (print, download, zoom toolbar). Both the in-page preview modal (DocumentViewButton) and
 * the standalone /documents/[id]/preview page fetch this and render the bytes themselves.
 */
export const GET = route<{ id: string }>({ auth: true, rateLimit: { limit: 20, windowMs: 60_000 } }, async ({ session, params, ctx }) => {
  const { url, mime, filename } = await viewVersion(getDb(), getStorage(), session!.actor, uuidParam(params.id, "Document"), ctx);
  return NextResponse.json({ url, mime, filename }, { headers: { "Cache-Control": "no-store" } });
});
