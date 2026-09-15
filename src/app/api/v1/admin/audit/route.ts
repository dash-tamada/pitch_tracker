import { getDb } from "@/server/db/client";
import { ok, queryObject, route } from "@/server/lib/http";
import { queryAudit } from "@/server/modules/admin/config";

export const GET = route({ auth: true }, async ({ req, session }) => ok(await queryAudit(getDb(), session!.actor, queryObject(req))));
