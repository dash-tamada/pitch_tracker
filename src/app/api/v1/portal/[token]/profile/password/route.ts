import { ok, readJson } from "@/server/lib/http";
import { creatorRoute } from "@/server/lib/creator-http";
import { changeMyPassword } from "@/server/modules/creator-portal/profile";

// Tight rate limit: this endpoint takes a guessed current-password attempt, same reasoning as login's lockout.
export const POST = creatorRoute<{ token: string }>({ auth: true, rateLimit: { limit: 10, windowMs: 60_000 } }, async ({ req, companyId, creator, ctx }) =>
  ok(await changeMyPassword(companyId, creator!.creatorId, creator!.sessionId, await readJson(req), ctx)));
