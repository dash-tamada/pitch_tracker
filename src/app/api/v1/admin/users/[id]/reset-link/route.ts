import { getDb } from "@/server/db/client";
import { ok, route, uuidParam } from "@/server/lib/http";
import { issuePasswordResetLink } from "@/server/modules/users/admin";

export const POST = route<{ id: string }>({ auth: true, rateLimit: { limit: 10, windowMs: 60_000 } }, async ({ session, params, ctx }) =>
  ok(await issuePasswordResetLink(getDb(), session!.actor, uuidParam(params.id, "User"), ctx)));
