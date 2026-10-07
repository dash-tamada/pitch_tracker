import { NextResponse } from "next/server";
import { readJson } from "@/server/lib/http";
import { publicCreatorRoute } from "@/server/lib/public-creator-http";
import { verifyPublicOtp } from "@/server/modules/public-creators/auth";

/** Sign-up step 2: the code proved the phone; the browser gets a one-time token to finish the profile with. */
export const POST = publicCreatorRoute({ auth: false, rateLimit: { limit: 10, windowMs: 60_000 } }, async ({ req, ctx, db }) => {
  const r = await verifyPublicOtp(db, await readJson(req), ctx);
  return NextResponse.json({ needsProfile: true, profileToken: r.profileToken });
});
