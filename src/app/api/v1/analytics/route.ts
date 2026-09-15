import { getDb } from "@/server/db/client";
import { ok, requirePermissionRoute, route } from "@/server/lib/http";
import { agingPitches, breakdowns, timeMetrics } from "@/server/modules/analytics/service";

export const GET = route({ auth: true }, async ({ session }) => {
  requirePermissionRoute(session!.actor, "analytics.view");
  const db = getDb();
  return ok({ breakdowns: await breakdowns(db, session!.actor), timeMetrics: await timeMetrics(db, session!.actor), aging: await agingPitches(db, session!.actor) });
});
