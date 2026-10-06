import { getPlatformDb } from "@/server/db/client";
import { ok, readJson, route } from "@/server/lib/http";
import { requestOtp } from "@/server/modules/auth/otp";

export const POST = route({ auth: false, rateLimit: { limit: 10, windowMs: 60_000 } }, async ({ req, ctx }) =>
  ok(await requestOtp(getPlatformDb(), await readJson(req), ctx)));
