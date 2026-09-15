import { NextResponse } from "next/server";
import { getDb } from "@/server/db/client";
import { route, uuidParam } from "@/server/lib/http";
import { downloadVersion } from "@/server/modules/documents/service";
import { getStorage } from "@/server/modules/storage";

/** Every call is logged ("who downloaded this script?") and returns a short-lived signed URL. */
export const GET = route<{ id: string }>({ auth: true, rateLimit: { limit: 20, windowMs: 60_000 } }, async ({ req, session, params, ctx }) => {
  const url = await downloadVersion(getDb(), getStorage(), session!.actor, uuidParam(params.id, "Document"), ctx);
  return NextResponse.redirect(new URL(url, req.nextUrl.origin), { status: 303, headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
});
