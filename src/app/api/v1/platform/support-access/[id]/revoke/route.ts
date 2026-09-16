import { getPlatformDb } from "@/server/db/client";
import { ok, route, uuidParam } from "@/server/lib/http";
import { revokeSupportAccess } from "@/server/modules/platform/service";

export const POST = route<{ id: string }>({ auth: true, scope: "PLATFORM" }, async ({ session, params, ctx }) =>
  ok(await revokeSupportAccess(getPlatformDb(), session!.actor, uuidParam(params.id, "Support access"), ctx)));
