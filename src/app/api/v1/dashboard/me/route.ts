import { getDb } from "@/server/db/client";
import { ok, route } from "@/server/lib/http";
import { myWork } from "@/server/modules/analytics/service";

export const GET = route({ auth: true }, async ({ session }) => ok(await myWork(getDb(), session!.actor)));
