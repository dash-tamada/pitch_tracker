import { NextResponse } from "next/server";
import { getDb } from "@/server/db/client";
import { AppError } from "@/server/lib/errors";
import { route, uuidParam } from "@/server/lib/http";
import { creatorPhotoUrl } from "@/server/modules/documents/service";
import { getStorage } from "@/server/modules/storage";

export const GET = route<{ id: string }>({ auth: true }, async ({ req, session, params }) => {
  const url = await creatorPhotoUrl(getDb(), getStorage(), session!.actor, uuidParam(params.id, "Creator"));
  if (!url) throw new AppError("NOT_FOUND", "No photo.");
  return NextResponse.redirect(new URL(url, req.nextUrl.origin), { status: 303, headers: { "Cache-Control": "private, max-age=60" } });
});
