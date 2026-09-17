import { getDb } from "@/server/db/client";
import { ok, route } from "@/server/lib/http";
import { disableCreatorPortalLink, getCreatorPortalLink, rotateCreatorPortalLink } from "@/server/modules/tenancy/company";

/** Whether a creator-portal link currently exists for this company (never returns the token itself). */
export const GET = route({ auth: true }, async ({ session }) => ok(await getCreatorPortalLink(getDb(), session!.actor)));

/** Issues a brand-new link, invalidating any previous one immediately (old links 404 from the next request on). */
export const POST = route({ auth: true, rateLimit: { limit: 5, windowMs: 60_000 } }, async ({ session, ctx }) =>
  ok(await rotateCreatorPortalLink(getDb(), session!.actor, ctx), 201));

export const DELETE = route({ auth: true }, async ({ session, ctx }) => ok(await disableCreatorPortalLink(getDb(), session!.actor, ctx)));
