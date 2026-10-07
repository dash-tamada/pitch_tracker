import { getDb } from "@/server/db/client";
import { ok, readJson, route } from "@/server/lib/http";
import { acknowledgeIntake } from "@/server/modules/pitches/intake";

export const POST = route({ auth: true }, async ({ req, session }) => ok(await acknowledgeIntake(getDb(), session!.actor, await readJson(req))));
