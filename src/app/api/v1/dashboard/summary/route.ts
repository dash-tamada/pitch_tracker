import { getDb } from "@/server/db/client";
import { ok, route } from "@/server/lib/http";
import { dashboardSummary, funnel } from "@/server/modules/analytics/service";

export const GET = route({ auth: true }, async ({ session }) => ok({ summary: await dashboardSummary(getDb(), session!.actor), funnel: await funnel(getDb(), session!.actor) }));
