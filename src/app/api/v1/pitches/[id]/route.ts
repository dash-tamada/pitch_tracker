import { getDb } from "@/server/db/client";
import { ok, readJson, route, uuidParam } from "@/server/lib/http";
import { getPitchDetail, updatePitch } from "@/server/modules/pitches/service";

export const GET = route<{ id: string }>({ auth: true }, async ({ session, params }) =>
  ok(await getPitchDetail(getDb(), session!.actor, uuidParam(params.id, "Pitch"))));
export const PATCH = route<{ id: string }>({ auth: true, rateLimit: { limit: 30, windowMs: 60_000 } }, async ({ req, session, params, ctx }) =>
  ok(await updatePitch(getDb(), session!.actor, uuidParam(params.id, "Pitch"), await readJson(req), ctx)));
