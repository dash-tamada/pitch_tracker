import { getDb } from "@/server/db/client";
import { ok, readJson, route } from "@/server/lib/http";
import { completeLogoUpload } from "@/server/modules/tenancy/company";
import { getStorage } from "@/server/modules/storage";

export const POST = route({ auth: true, rateLimit: { limit: 20, windowMs: 60_000 } }, async ({ req, session, ctx }) =>
  ok(await completeLogoUpload(getDb(), session!.actor, getStorage(), await readJson(req), ctx)));
