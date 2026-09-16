import { getDb } from "@/server/db/client";
import { ok, readJson, route } from "@/server/lib/http";
import { removeEmailException } from "@/server/modules/tenancy/company";

export const POST = route({ auth: true }, async ({ req, session, ctx }) => ok(await removeEmailException(getDb(), session!.actor, await readJson(req), ctx)));
