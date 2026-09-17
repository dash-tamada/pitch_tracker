import { ok, readJson } from "@/server/lib/http";
import { creatorRoute } from "@/server/lib/creator-http";
import { listMyPitches, submitCreatorPitch } from "@/server/modules/creator-portal/pitch";

export const GET = creatorRoute<{ token: string }>({ auth: true }, async ({ companyId, creator }) =>
  ok({ pitches: await listMyPitches(companyId, creator!.creatorId) }));

export const POST = creatorRoute<{ token: string }>({ auth: true, rateLimit: { limit: 20, windowMs: 60_000 } }, async ({ req, companyId, creator, ctx }) =>
  ok(await submitCreatorPitch(companyId, creator!.creatorId, await readJson(req), ctx), 201));
