import { ok, readJson } from "@/server/lib/http";
import { publicCreatorRoute } from "@/server/lib/public-creator-http";
import { completePhoto } from "@/server/modules/public-creators/profile";
import { getStorage } from "@/server/modules/storage";

/** Step 3: the server re-reads the uploaded bytes, checks they really are a photo, and only then keeps it. */
export const POST = publicCreatorRoute({ rateLimit: { limit: 10, windowMs: 60_000 } }, async ({ req, db, creator }) =>
  ok(await completePhoto(db, creator!.creatorId, getStorage(), await readJson(req))));
