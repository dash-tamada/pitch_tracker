import { getDb } from "@/server/db/client";
import { ok, readJson, route } from "@/server/lib/http";
import { addEmailException } from "@/server/modules/tenancy/company";

export const POST = route({ auth: true, rateLimit: { limit: 20, windowMs: 60_000 } }, async ({ req, session, ctx }) => ok(await addEmailException(getDb(), session!.actor, await readJson(req), ctx), 201));
