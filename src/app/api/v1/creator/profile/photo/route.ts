import { NextResponse } from "next/server";
import { ok, readJson } from "@/server/lib/http";
import { publicCreatorRoute } from "@/server/lib/public-creator-http";
import { createPhotoUpload, photoReadUrl } from "@/server/modules/public-creators/profile";
import { getStorage } from "@/server/modules/storage";

/** The writer's own photo: what an <img> follows to a short-lived signed link. */
export const GET = publicCreatorRoute({}, async ({ db, creator }) => NextResponse.redirect(await photoReadUrl(db, creator!.creatorId, getStorage())));
/** Step 1 of changing it: a one-time upload URL. */
export const POST = publicCreatorRoute({ rateLimit: { limit: 10, windowMs: 60_000 } }, async ({ req, creator }) =>
  ok(await createPhotoUpload(creator!.creatorId, getStorage(), await readJson(req))));
