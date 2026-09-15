import { getDb } from "@/server/db/client";
import { ok, readJson, route, uuidParam } from "@/server/lib/http";
import { addCreatorProject } from "@/server/modules/creators/service";

export const POST = route<{ id: string }>({ auth: true }, async ({ req, session, params, ctx }) =>
  ok(await addCreatorProject(getDb(), session!.actor, uuidParam(params.id, "Creator"), await readJson(req), ctx), 201));
