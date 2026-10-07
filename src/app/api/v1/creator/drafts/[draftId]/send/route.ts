import { ok, readJson } from "@/server/lib/http";
import { publicCreatorRoute } from "@/server/lib/public-creator-http";
import { sendDraftToCompanies } from "@/server/modules/public-creators/send";
import { getStorage } from "@/server/modules/storage";

export const POST = publicCreatorRoute<{ draftId: string }>({ rateLimit: { limit: 5, windowMs: 60_000 } }, async ({ req, ctx, db, creator, params }) =>
  ok(await sendDraftToCompanies(db, creator!.creatorId, params.draftId, getStorage(), await readJson(req), ctx)));
