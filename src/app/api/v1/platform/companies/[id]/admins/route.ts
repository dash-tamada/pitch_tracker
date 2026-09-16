import { getPlatformDb } from "@/server/db/client";
import { ok, readJson, route, uuidParam } from "@/server/lib/http";
import { createCompanyAdminWithPassword } from "@/server/modules/platform/service";

export const POST = route<{ id: string }>({ auth: true, scope: "PLATFORM", rateLimit: { limit: 10, windowMs: 60_000 } }, async ({ req, session, params, ctx }) =>
  ok(await createCompanyAdminWithPassword(getPlatformDb(), session!.actor, uuidParam(params.id, "Company"), await readJson(req), ctx), 201));
