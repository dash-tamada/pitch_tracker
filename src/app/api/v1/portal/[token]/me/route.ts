import { ok } from "@/server/lib/http";
import { creatorRoute } from "@/server/lib/creator-http";

/** Whether the portal link is valid, and — when a session cookie is also present — who is signed in. */
export const GET = creatorRoute<{ token: string }>({ auth: true }, async ({ creator }) =>
  ok({ creatorId: creator!.creatorId, profileCompleted: creator!.profileCompleted }));
