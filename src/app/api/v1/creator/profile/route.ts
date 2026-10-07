import { ok, readJson } from "@/server/lib/http";
import { publicCreatorRoute } from "@/server/lib/public-creator-http";
import { getMyProfile, saveMyProfile } from "@/server/modules/public-creators/profile";

export const GET = publicCreatorRoute({}, async ({ db, creator }) => ok(await getMyProfile(db, creator!.creatorId)));
export const PATCH = publicCreatorRoute({ rateLimit: { limit: 20, windowMs: 60_000 } }, async ({ req, db, creator }) =>
  ok(await saveMyProfile(db, creator!.creatorId, await readJson(req))));
