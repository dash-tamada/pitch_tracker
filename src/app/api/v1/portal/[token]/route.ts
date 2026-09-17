import { ok } from "@/server/lib/http";
import { creatorRoute } from "@/server/lib/creator-http";

/**
 * Unauthenticated link check — lets the portal landing page confirm the link is live before showing the
 * register/login choice, without requiring a session. creatorRoute already resolves the token to a company
 * (throwing NOT_FOUND if it is unknown or disabled) regardless of `auth`, so reaching the handler at all is
 * the "valid" signal.
 */
export const GET = creatorRoute<{ token: string }>({ auth: false, rateLimit: { limit: 60, windowMs: 60_000 } }, async () => ok({ valid: true }));
