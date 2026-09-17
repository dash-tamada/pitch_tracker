import { ok, uuidParam } from "@/server/lib/http";
import { creatorRoute } from "@/server/lib/creator-http";
import { listMyPitchDocuments } from "@/server/modules/creator-portal/documents";

export const GET = creatorRoute<{ token: string; pitchId: string }>({ auth: true }, async ({ companyId, creator, params }) =>
  ok({ documents: await listMyPitchDocuments(companyId, creator!.creatorId, uuidParam(params.pitchId, "Pitch")) }));
