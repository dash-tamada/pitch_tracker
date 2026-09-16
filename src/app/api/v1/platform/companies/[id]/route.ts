import { getPlatformDb } from "@/server/db/client";
import { ok, readJson, route, uuidParam } from "@/server/lib/http";
import { getCompany, updateCompany } from "@/server/modules/platform/service";

export const GET = route<{ id: string }>({ auth: true, scope: "PLATFORM" }, async ({ session, params }) => ok(await getCompany(getPlatformDb(), session!.actor, uuidParam(params.id, "Company"))));
export const PATCH = route<{ id: string }>({ auth: true, scope: "PLATFORM" }, async ({ req, session, params, ctx }) =>
  ok(await updateCompany(getPlatformDb(), session!.actor, uuidParam(params.id, "Company"), await readJson(req), ctx)));
