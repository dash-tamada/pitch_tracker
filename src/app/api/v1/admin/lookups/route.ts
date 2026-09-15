import { getDb } from "@/server/db/client";
import { ok, readJson, route } from "@/server/lib/http";
import { listLookups, upsertLookup } from "@/server/modules/admin/config";

export const GET = route({ auth: true }, async ({ session }) => ok({ lookups: await listLookups(getDb(), session!.actor) }));
export const POST = route({ auth: true }, async ({ req, session, ctx }) => ok(await upsertLookup(getDb(), session!.actor, await readJson(req), ctx)));
