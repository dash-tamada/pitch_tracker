import { getDb } from "@/server/db/client";
import { ok, readJson, route } from "@/server/lib/http";
import { getActiveWorkflow, publishWorkflowVersion } from "@/server/modules/admin/config";

export const GET = route({ auth: true }, async ({ session }) => ok(await getActiveWorkflow(getDb(), session!.actor)));
export const POST = route({ auth: true, rateLimit: { limit: 5, windowMs: 60_000 } }, async ({ req, session, ctx }) => ok(await publishWorkflowVersion(getDb(), session!.actor, await readJson(req), ctx), 201));
