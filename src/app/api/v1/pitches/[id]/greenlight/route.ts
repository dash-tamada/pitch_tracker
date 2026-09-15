import { getDb } from "@/server/db/client";
import { ok, readJson, route, uuidParam } from "@/server/lib/http";
import { greenlight } from "@/server/modules/production/service";

export const POST = route<{ id: string }>({ auth: true }, async ({ req, session, params, ctx }) =>
  ok(await greenlight(getDb(), session!.actor, uuidParam(params.id, "Pitch"), await readJson(req), ctx), 201));
