import { getDb } from "@/server/db/client";
import { ok, readJson, route, uuidParam } from "@/server/lib/http";
import { getCreatorProfile, updateCreator } from "@/server/modules/creators/service";

export const GET = route<{ id: string }>({ auth: true }, async ({ session, params }) =>
  ok(await getCreatorProfile(getDb(), session!.actor, uuidParam(params.id, "Creator"))));

export const PATCH = route<{ id: string }>({ auth: true, rateLimit: { limit: 30, windowMs: 60_000 } }, async ({ req, session, params, ctx }) =>
  ok(await updateCreator(getDb(), session!.actor, uuidParam(params.id, "Creator"), await readJson(req), ctx)));
