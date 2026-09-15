import { getDb } from "@/server/db/client";
import { ok, readJson, route } from "@/server/lib/http";
import { getAllSettings, updateSettings } from "@/server/modules/admin/config";

export const GET = route({ auth: true }, async ({ session }) => ok(await getAllSettings(getDb(), session!.actor)));
export const PATCH = route({ auth: true }, async ({ req, session, ctx }) => ok(await updateSettings(getDb(), session!.actor, await readJson(req), ctx)));
