import { getDb } from "@/server/db/client";
import { ok, readJson, route } from "@/server/lib/http";
import { getMyCompany, updateMyCompany } from "@/server/modules/tenancy/company";

export const GET = route({ auth: true }, async ({ session }) => ok(await getMyCompany(getDb(), session!.actor)));
export const PATCH = route({ auth: true }, async ({ req, session, ctx }) => ok(await updateMyCompany(getDb(), session!.actor, await readJson(req), ctx)));
