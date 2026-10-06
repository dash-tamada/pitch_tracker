import { getDb } from "@/server/db/client";
import { ok, readJson, route } from "@/server/lib/http";
import { setOwnWhatsapp } from "@/server/modules/users/profile";

export const PATCH = route({ auth: true }, async ({ req, ctx, session }) =>
  ok(await setOwnWhatsapp(getDb(session!.actor), session!.actor, await readJson(req), ctx)));
