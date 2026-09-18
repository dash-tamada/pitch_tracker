import { ok, readJson } from "@/server/lib/http";
import { creatorRoute } from "@/server/lib/creator-http";
import { addMyProject, listMyProjects } from "@/server/modules/creator-portal/profile";

export const GET = creatorRoute<{ token: string }>({ auth: true }, async ({ companyId, creator }) =>
  ok({ projects: await listMyProjects(companyId, creator!.creatorId) }));

export const POST = creatorRoute<{ token: string }>({ auth: true }, async ({ req, companyId, creator, ctx }) =>
  ok(await addMyProject(companyId, creator!.creatorId, await readJson(req), ctx), 201));
