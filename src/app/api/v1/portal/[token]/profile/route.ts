import { ok, readJson } from "@/server/lib/http";
import { creatorRoute } from "@/server/lib/creator-http";
import { getMyProfile, updateMyProfile } from "@/server/modules/creator-portal/profile";

export const GET = creatorRoute<{ token: string }>({ auth: true }, async ({ companyId, creator }) =>
  ok(await getMyProfile(companyId, creator!.creatorId)));

export const PATCH = creatorRoute<{ token: string }>({ auth: true }, async ({ req, companyId, creator, ctx }) =>
  ok(await updateMyProfile(companyId, creator!.creatorId, await readJson(req), ctx)));
