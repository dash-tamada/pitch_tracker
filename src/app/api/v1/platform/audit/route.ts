import { getPlatformDb } from "@/server/db/client";
import { ok, queryObject, route } from "@/server/lib/http";
import { platformAudit } from "@/server/modules/platform/service";

export const GET = route({ auth: true, scope: "PLATFORM" }, async ({ req, session }) => ok(await platformAudit(getPlatformDb(), session!.actor, queryObject(req))));
