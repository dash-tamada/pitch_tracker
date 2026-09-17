import { getPlatformDb } from "@/server/db/client";
import { ok, readJson, route } from "@/server/lib/http";
import { changeOwnPassword } from "@/server/modules/auth/service";

/** Voluntary password change for a signed-in, MFA-verified account of any scope (company or platform). */
export const POST = route({ auth: true, scope: "ANY", rateLimit: { limit: 5, windowMs: 15 * 60_000 } },
  async ({ session, req, ctx }) => ok(await changeOwnPassword(getPlatformDb(), session!.actor, session!.sessionId, await readJson(req), ctx)));
