import { getPlatformDb } from "@/server/db/client";
import { ok, readJson, route, uuidParam } from "@/server/lib/http";
import { updateSubscription } from "@/server/modules/platform/service";

export const PATCH = route<{ id: string }>({ auth: true, scope: "PLATFORM" }, async ({ req, session, params, ctx }) =>
  ok(await updateSubscription(getPlatformDb(), session!.actor, uuidParam(params.id, "Company"), await readJson(req), ctx)));
