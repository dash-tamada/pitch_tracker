import { getDb } from "@/server/db/client";
import { ok, readJson, route } from "@/server/lib/http";
import { markRead } from "@/server/modules/notifications/service";

export const POST = route({ auth: true }, async ({ req, session }) => ok(await markRead(getDb(), session!.actor, await readJson(req))));
