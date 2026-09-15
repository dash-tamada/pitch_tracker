import { getDb } from "@/server/db/client";
import { ok, readJson, route, uuidParam } from "@/server/lib/http";
import { updateUser } from "@/server/modules/users/admin";

export const PATCH = route<{ id: string }>({ auth: true }, async ({ req, session, params, ctx }) => ok(await updateUser(getDb(), session!.actor, uuidParam(params.id, "User"), await readJson(req), ctx)));
