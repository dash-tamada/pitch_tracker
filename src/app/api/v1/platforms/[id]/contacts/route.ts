import { getDb } from "@/server/db/client";
import { ok, readJson, route, uuidParam } from "@/server/lib/http";
import { addPlatformContact } from "@/server/modules/platforms/service";

export const POST = route<{ id: string }>({ auth: true }, async ({ req, session, params, ctx }) =>
  ok(await addPlatformContact(getDb(), session!.actor, uuidParam(params.id, "Platform"), await readJson(req), ctx), 201));
