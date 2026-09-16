import { getPlatformDb } from "@/server/db/client";
import { ok, readJson, route } from "@/server/lib/http";
import { listPlans, upsertPlan } from "@/server/modules/platform/service";

export const GET = route({ auth: true, scope: "PLATFORM" }, async ({ session }) => ok({ plans: await listPlans(getPlatformDb(), session!.actor) }));
export const POST = route({ auth: true, scope: "PLATFORM" }, async ({ req, session, ctx }) => ok(await upsertPlan(getPlatformDb(), session!.actor, await readJson(req), ctx)));
