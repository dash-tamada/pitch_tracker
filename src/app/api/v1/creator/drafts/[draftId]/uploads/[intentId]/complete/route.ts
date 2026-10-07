import { ok } from "@/server/lib/http";
import { publicCreatorRoute } from "@/server/lib/public-creator-http";
import { completeUpload } from "@/server/modules/public-creators/drafts";
import { getStorage } from "@/server/modules/storage";

export const POST = publicCreatorRoute<{ draftId: string; intentId: string }>({ rateLimit: { limit: 20, windowMs: 60_000 } }, async ({ db, creator, params }) =>
  ok(await completeUpload(db, creator!.creatorId, params.draftId, params.intentId, getStorage())));
