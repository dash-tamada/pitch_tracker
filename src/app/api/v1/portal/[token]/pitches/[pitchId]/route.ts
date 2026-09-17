import { ok, uuidParam } from "@/server/lib/http";
import { creatorRoute } from "@/server/lib/creator-http";
import { getMyPitch } from "@/server/modules/creator-portal/pitch";

export const GET = creatorRoute<{ token: string; pitchId: string }>({ auth: true }, async ({ companyId, creator, params }) =>
  ok(await getMyPitch(companyId, creator!.creatorId, uuidParam(params.pitchId, "Pitch"))));
