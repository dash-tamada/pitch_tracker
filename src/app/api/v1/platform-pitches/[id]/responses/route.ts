import { getDb } from "@/server/db/client";
import { ok, readJson, route, uuidParam } from "@/server/lib/http";
import { recordPlatformResponse } from "@/server/modules/platforms/service";

export const POST = route<{ id: string }>({ auth: true, rateLimit: { limit: 30, windowMs: 60_000 } }, async ({ req, session, params, ctx }) =>
  ok(await recordPlatformResponse(getDb(), session!.actor, uuidParam(params.id, "Platform pitch"), await readJson(req), ctx), 201));
