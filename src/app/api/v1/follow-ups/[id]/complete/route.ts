import { getDb } from "@/server/db/client";
import { ok, readJson, route, uuidParam } from "@/server/lib/http";
import { completeFollowUp } from "@/server/modules/platforms/service";

export const POST = route<{ id: string }>({ auth: true }, async ({ req, session, params, ctx }) =>
  ok(await completeFollowUp(getDb(), session!.actor, uuidParam(params.id, "Follow-up"), await readJson(req), ctx)));
