import { getDb } from "@/server/db/client";
import { ok, queryObject, route } from "@/server/lib/http";
import { listNotifications } from "@/server/modules/notifications/service";

export const GET = route({ auth: true }, async ({ req, session }) => ok(await listNotifications(getDb(), session!.actor, queryObject(req))));
