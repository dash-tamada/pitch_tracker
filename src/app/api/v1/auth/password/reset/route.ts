import { getPlatformDb } from "@/server/db/client";
import { ok, readJson, route } from "@/server/lib/http";
import { completePasswordReset } from "@/server/modules/users/admin";

export const POST = route({ auth: false, rateLimit: { limit: 10, windowMs: 15 * 60_000 } }, async ({ req, ctx }) => ok(await completePasswordReset(getPlatformDb(), await readJson(req), ctx)));
