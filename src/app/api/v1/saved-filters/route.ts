import { getDb } from "@/server/db/client";
import { ok, readJson, route } from "@/server/lib/http";
import { listSavedFilters, saveFilter } from "@/server/modules/filters/service";

export const GET = route({ auth: true }, async ({ session }) => ok({ filters: await listSavedFilters(getDb(), session!.actor) }));
export const POST = route({ auth: true }, async ({ req, session }) => ok(await saveFilter(getDb(), session!.actor, await readJson(req)), 201));
