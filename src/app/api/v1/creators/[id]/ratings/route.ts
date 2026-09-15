import { getDb } from "@/server/db/client";
import { ok, route, uuidParam } from "@/server/lib/http";
import { creatorRatings } from "@/server/modules/ratings/service";

export const GET = route<{ id: string }>({ auth: true }, async ({ session, params }) =>
  ok(await creatorRatings(getDb(), session!.actor, uuidParam(params.id, "Creator"))));
