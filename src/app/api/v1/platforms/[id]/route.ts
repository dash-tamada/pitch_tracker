import { getDb } from "@/server/db/client";
import { ok, readJson, route, uuidParam } from "@/server/lib/http";
import { getPlatform, updatePlatform } from "@/server/modules/platforms/service";

export const GET = route<{ id: string }>({ auth: true }, async ({ session, params }) => ok(await getPlatform(getDb(), session!.actor, uuidParam(params.id, "Platform"))));
export const PATCH = route<{ id: string }>({ auth: true }, async ({ req, session, params, ctx }) =>
  ok(await updatePlatform(getDb(), session!.actor, uuidParam(params.id, "Platform"), await readJson(req), ctx)));
