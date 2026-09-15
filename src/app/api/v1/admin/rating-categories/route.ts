import { getDb } from "@/server/db/client";
import { ok, readJson, route } from "@/server/lib/http";
import { upsertRatingCategory } from "@/server/modules/admin/config";

export const POST = route({ auth: true }, async ({ req, session, ctx }) => ok(await upsertRatingCategory(getDb(), session!.actor, await readJson(req), ctx)));
