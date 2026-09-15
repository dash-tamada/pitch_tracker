import { getDb } from "@/server/db/client";
import { ok, route } from "@/server/lib/http";
import { productionPipeline } from "@/server/modules/production/service";

export const GET = route({ auth: true }, async ({ session }) => ok({ items: await productionPipeline(getDb(), session!.actor) }));
