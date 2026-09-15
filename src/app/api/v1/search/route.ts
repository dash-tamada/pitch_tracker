import { getDb } from "@/server/db/client";
import { ok, queryObject, route } from "@/server/lib/http";
import { globalSearch } from "@/server/modules/search/service";

export const GET = route({ auth: true, rateLimit: { limit: 60, windowMs: 60_000 } }, async ({ req, session }) => ok(await globalSearch(getDb(), session!.actor, queryObject(req))));
