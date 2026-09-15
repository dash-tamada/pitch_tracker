import { getDb } from "@/server/db/client";
import { ok, route } from "@/server/lib/http";
import { developmentPipeline } from "@/server/modules/production/service";

export const GET = route({ auth: true }, async ({ session }) => ok(await developmentPipeline(getDb(), session!.actor)));
