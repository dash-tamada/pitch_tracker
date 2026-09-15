import { getDb } from "@/server/db/client";
import { ok, readJson, route, uuidParam } from "@/server/lib/http";
import { updateProductionDetails } from "@/server/modules/production/service";

export const PATCH = route<{ id: string }>({ auth: true }, async ({ req, session, params, ctx }) =>
  ok(await updateProductionDetails(getDb(), session!.actor, uuidParam(params.id, "Production project"), await readJson(req), ctx)));
