import { ok, readJson } from "@/server/lib/http";
import { publicCreatorRoute } from "@/server/lib/public-creator-http";
import { requestPublicOtp } from "@/server/modules/public-creators/auth";

export const POST = publicCreatorRoute({ auth: false, rateLimit: { limit: 10, windowMs: 60_000 } }, async ({ req, ctx, db }) => ok(await requestPublicOtp(db, await readJson(req), ctx)));
