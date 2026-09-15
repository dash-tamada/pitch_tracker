import { getDb } from "@/server/db/client";
import { ok, route, uuidParam } from "@/server/lib/http";
import { deleteSavedFilter } from "@/server/modules/filters/service";

export const DELETE = route<{ id: string }>({ auth: true }, async ({ session, params }) =>
  ok(await deleteSavedFilter(getDb(), session!.actor, uuidParam(params.id, "Saved filter"))));
