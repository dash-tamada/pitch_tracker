import { getPlatformDb } from "@/server/db/client";
import { ok, readJson, route } from "@/server/lib/http";
import { createCompany, listCompanies } from "@/server/modules/platform/service";

export const GET = route({ auth: true, scope: "PLATFORM" }, async ({ session }) => ok({ companies: await listCompanies(getPlatformDb(), session!.actor) }));
export const POST = route({ auth: true, scope: "PLATFORM", rateLimit: { limit: 10, windowMs: 60_000 } }, async ({ req, session, ctx }) =>
  ok(await createCompany(getPlatformDb(), session!.actor, await readJson(req), ctx), 201));
