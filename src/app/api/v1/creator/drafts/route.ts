import { ok, readJson } from "@/server/lib/http";
import { publicCreatorRoute } from "@/server/lib/public-creator-http";
import { createDraft, listMyDrafts } from "@/server/modules/public-creators/drafts";

export const GET = publicCreatorRoute({}, async ({ db, creator }) => ok({ drafts: await listMyDrafts(db, creator!.creatorId) }));
export const POST = publicCreatorRoute({ rateLimit: { limit: 20, windowMs: 60_000 } }, async ({ req, db, creator }) => ok(await createDraft(db, creator!.creatorId, await readJson(req)), 201));
