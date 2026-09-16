import { getPlatformDb } from "@/server/db/client";
import { ok, route } from "@/server/lib/http";
import { platformOverview } from "@/server/modules/platform/service";

export const GET = route({ auth: true, scope: "PLATFORM" }, async ({ session }) => ok(await platformOverview(getPlatformDb(), session!.actor)));
