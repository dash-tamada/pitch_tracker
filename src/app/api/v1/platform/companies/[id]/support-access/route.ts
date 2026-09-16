import { getPlatformDb } from "@/server/db/client";
import { ok, readJson, route, uuidParam } from "@/server/lib/http";
import { requestSupportAccess, supportView } from "@/server/modules/platform/service";

export const GET = route<{ id: string }>({ auth: true, scope: "PLATFORM", rateLimit: { limit: 30, windowMs: 60_000 } }, async ({ session, params, ctx }) =>
  ok(await supportView(getPlatformDb(), session!.actor, uuidParam(params.id, "Company"), ctx)));
export const POST = route<{ id: string }>({ auth: true, scope: "PLATFORM", rateLimit: { limit: 10, windowMs: 60_000 } }, async ({ req, session, params, ctx }) =>
  ok(await requestSupportAccess(getPlatformDb(), session!.actor, uuidParam(params.id, "Company"), await readJson(req), ctx), 201));
