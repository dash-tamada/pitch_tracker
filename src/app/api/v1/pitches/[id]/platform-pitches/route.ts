import { getDb } from "@/server/db/client";
import { ok, readJson, route, uuidParam } from "@/server/lib/http";
import { pitchPlatformPitches, recordPlatformPitch } from "@/server/modules/platforms/service";

export const GET = route<{ id: string }>({ auth: true }, async ({ session, params }) =>
  ok({ platformPitches: await pitchPlatformPitches(getDb(), session!.actor, uuidParam(params.id, "Pitch")) }));
export const POST = route<{ id: string }>({ auth: true, rateLimit: { limit: 30, windowMs: 60_000 } }, async ({ req, session, params, ctx }) =>
  ok(await recordPlatformPitch(getDb(), session!.actor, uuidParam(params.id, "Pitch"), await readJson(req), ctx), 201));
