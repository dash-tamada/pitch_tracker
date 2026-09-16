import { getPlatformDb } from "@/server/db/client";
import { ok, readJson, route } from "@/server/lib/http";
import { confirmEnrolment } from "@/server/modules/auth/mfa";

export const POST = route({ auth: true, scope: "ANY", allowWithoutMfa: true, rateLimit: { limit: 5, windowMs: 60_000 } }, async ({ req, session, ctx }) => {
  await confirmEnrolment(getPlatformDb(), session!.actor.userId, session!.sessionId, await readJson(req), ctx);
  return ok({ ok: true });
});
