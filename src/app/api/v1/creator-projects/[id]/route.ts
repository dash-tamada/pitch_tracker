import { getDb } from "@/server/db/client";
import { ok, readJson, route, uuidParam } from "@/server/lib/http";
import { updateCreatorProject } from "@/server/modules/creators/service";

export const PATCH = route<{ id: string }>({ auth: true }, async ({ req, session, params, ctx }) =>
  ok(await updateCreatorProject(getDb(), session!.actor, uuidParam(params.id, "Project"), await readJson(req), ctx)));
