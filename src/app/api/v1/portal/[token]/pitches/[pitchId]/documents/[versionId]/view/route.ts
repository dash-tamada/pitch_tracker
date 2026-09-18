import { ok, uuidParam } from "@/server/lib/http";
import { creatorRoute } from "@/server/lib/creator-http";
import { getMyViewUrl } from "@/server/modules/creator-portal/documents";
import { getStorage } from "@/server/modules/storage";

// Same access checks/logging as download, but JSON with an inline preview URL — never a redirect (the raw
// file must never be navigated to directly; see document-preview.tsx's own comment on why).
export const GET = creatorRoute<{ token: string; pitchId: string; versionId: string }>(
  { auth: true, rateLimit: { limit: 20, windowMs: 60_000 } },
  async ({ companyId, creator, params }) =>
    ok(await getMyViewUrl(companyId, creator!.creatorId, uuidParam(params.versionId, "Document"), getStorage())),
);
