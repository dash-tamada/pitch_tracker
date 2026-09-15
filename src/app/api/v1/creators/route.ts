import { getDb } from "@/server/db/client";
import { ok, queryObject, readJson, route } from "@/server/lib/http";
import { createCreator, listCreators } from "@/server/modules/creators/service";

export const GET = route({ auth: true }, async ({ req, session }) => ok(await listCreators(getDb(), session!.actor, queryObject(req))));

export const POST = route({ auth: true, rateLimit: { limit: 30, windowMs: 60_000 } }, async ({ req, session, ctx }) =>
  ok(await createCreator(getDb(), session!.actor, await readJson(req), ctx), 201));
