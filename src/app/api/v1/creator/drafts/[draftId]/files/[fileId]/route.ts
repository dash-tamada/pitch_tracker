import { NextResponse } from "next/server";
import { ok } from "@/server/lib/http";
import { publicCreatorRoute } from "@/server/lib/public-creator-http";
import { fileDownloadUrl, removeFile } from "@/server/modules/public-creators/drafts";
import { getStorage } from "@/server/modules/storage";

type P = { draftId: string; fileId: string };
export const GET = publicCreatorRoute<P>({}, async ({ req, db, creator, params }) =>
  NextResponse.redirect(new URL(await fileDownloadUrl(db, creator!.creatorId, params.draftId, params.fileId, getStorage()), req.nextUrl.origin), { status: 303, headers: { "Cache-Control": "no-store" } }));
export const DELETE = publicCreatorRoute<P>({}, async ({ db, creator, params }) => ok(await removeFile(db, creator!.creatorId, params.draftId, params.fileId, getStorage())));
