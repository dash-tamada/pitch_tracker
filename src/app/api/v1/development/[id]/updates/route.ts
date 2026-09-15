import { getDb } from "@/server/db/client";
import { ok, readJson, route, uuidParam } from "@/server/lib/http";
import { addDevelopmentUpdate } from "@/server/modules/production/service";

export const POST = route<{ id: string }>({ auth: true }, async ({ req, session, params, ctx }) =>
  ok(await addDevelopmentUpdate(getDb(), session!.actor, uuidParam(params.id, "Development project"), await readJson(req), ctx), 201));
