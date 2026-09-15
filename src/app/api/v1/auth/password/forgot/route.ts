import { getDb } from "@/server/db/client";
import { ok, readJson, route } from "@/server/lib/http";
import { requestPasswordReset } from "@/server/modules/users/admin";

export const POST = route({ auth: false, rateLimit: { limit: 5, windowMs: 15 * 60_000 } }, async ({ req, ctx }) => ok(await requestPasswordReset(getDb(), await readJson(req), ctx)));
