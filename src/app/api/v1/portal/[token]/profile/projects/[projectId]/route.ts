import { ok, readJson, uuidParam } from "@/server/lib/http";
import { creatorRoute } from "@/server/lib/creator-http";
import { updateMyProject } from "@/server/modules/creator-portal/profile";

// Edit and archive both go through PATCH ({ archived: true } to remove it from the profile) — mirrors
// staff's updateCreatorProject (creators/service.ts), which uses the same single-endpoint pattern.
export const PATCH = creatorRoute<{ token: string; projectId: string }>({ auth: true }, async ({ req, companyId, creator, params }) =>
  ok(await updateMyProject(companyId, creator!.creatorId, uuidParam(params.projectId, "Project"), await readJson(req))));
