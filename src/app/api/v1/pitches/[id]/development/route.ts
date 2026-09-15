import { getDb } from "@/server/db/client";
import { ok, readJson, route, uuidParam } from "@/server/lib/http";
import { pitchDevelopmentAndProduction, startDevelopment } from "@/server/modules/production/service";

export const GET = route<{ id: string }>({ auth: true }, async ({ session, params }) =>
  ok(await pitchDevelopmentAndProduction(getDb(), session!.actor, uuidParam(params.id, "Pitch"))));
export const POST = route<{ id: string }>({ auth: true }, async ({ req, session, params, ctx }) =>
  ok(await startDevelopment(getDb(), session!.actor, uuidParam(params.id, "Pitch"), await readJson(req), ctx), 201));
