import { NextResponse } from "next/server";
import { ok } from "@/server/lib/http";
import { publicCreatorRoute } from "@/server/lib/public-creator-http";
import { fileDownloadUrl, removeFile } from "@/server/modules/public-creators/drafts";
import { getStorage } from "@/server/modules/storage";

type P = { draftId: string; fileId: string };
export const GET = publicCreatorRoute<P>({}, async ({ db, creator, params }) =>
  NextResponse.redirect(await fileDownloadUrl(db, creator!.creatorId, params.draftId, params.fileId, getStorage())));
export const DELETE = publicCreatorRoute<P>({}, async ({ db, creator, params }) => ok(await removeFile(db, creator!.creatorId, params.draftId, params.fileId, getStorage())));
