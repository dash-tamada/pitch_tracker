import { getPlatformDb } from "@/server/db/client";
import { ok, readJson, route } from "@/server/lib/http";
import { completeRequiredPasswordChange } from "@/server/modules/auth/service";

/**
 * Only reachable with a valid session whose password change is still pending (or already done — the
 * service call itself rejects a second attempt). Runs before MFA, so both gates are lifted here.
 */
export const POST = route({ auth: true, scope: "ANY", allowWithoutMfa: true, allowWithoutPasswordChange: true, rateLimit: { limit: 10, windowMs: 15 * 60_000 } },
  async ({ req, session, ctx }) => ok(await completeRequiredPasswordChange(getPlatformDb(), session!.actor, await readJson(req), ctx)));
