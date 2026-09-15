import { getDb } from "@/server/db/client";
import { ok, readJson, route, uuidParam } from "@/server/lib/http";
import { addPitchRating } from "@/server/modules/ratings/service";

export const POST = route<{ id: string }>({ auth: true, rateLimit: { limit: 30, windowMs: 60_000 } }, async ({ req, session, params, ctx }) =>
  ok(await addPitchRating(getDb(), session!.actor, uuidParam(params.id, "Pitch"), await readJson(req), ctx), 201));
