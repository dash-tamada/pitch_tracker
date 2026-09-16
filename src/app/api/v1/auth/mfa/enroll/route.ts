import { getPlatformDb } from "@/server/db/client";
import { ok, route } from "@/server/lib/http";
import { beginEnrolment } from "@/server/modules/auth/mfa";

export const POST = route({ auth: true, scope: "ANY", allowWithoutMfa: true, rateLimit: { limit: 5, windowMs: 60_000 } }, async ({ session, ctx }) =>
  ok(await beginEnrolment(getPlatformDb(), session!.actor.userId, ctx)));
