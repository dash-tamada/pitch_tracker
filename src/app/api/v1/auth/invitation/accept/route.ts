import { getPlatformDb } from "@/server/db/client";
import { ok, readJson, route } from "@/server/lib/http";
import { acceptInvitation } from "@/server/modules/tenancy/invitations";

export const POST = route({ auth: false, rateLimit: { limit: 10, windowMs: 15 * 60_000 } }, async ({ req, ctx }) => ok(await acceptInvitation(getPlatformDb(), await readJson(req), ctx)));
