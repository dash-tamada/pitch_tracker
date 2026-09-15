import { getDb } from "@/server/db/client";
import { ok, readJson, route, uuidParam } from "@/server/lib/http";
import { updatePlatformContact } from "@/server/modules/platforms/service";

export const PATCH = route<{ id: string }>({ auth: true }, async ({ req, session, params, ctx }) =>
  ok(await updatePlatformContact(getDb(), session!.actor, uuidParam(params.id, "Contact"), await readJson(req), ctx)));
