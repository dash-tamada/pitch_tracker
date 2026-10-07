import { ok, readJson } from "@/server/lib/http";
import { publicCreatorRoute } from "@/server/lib/public-creator-http";
import { createUploadIntent } from "@/server/modules/public-creators/drafts";
import { getStorage } from "@/server/modules/storage";

export const POST = publicCreatorRoute<{ draftId: string }>({ rateLimit: { limit: 20, windowMs: 60_000 } }, async ({ req, db, creator, params }) =>
  ok(await createUploadIntent(db, creator!.creatorId, params.draftId, getStorage(), await readJson(req))));
