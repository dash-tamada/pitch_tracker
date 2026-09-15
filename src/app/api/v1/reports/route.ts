import { getDb } from "@/server/db/client";
import { ok, route } from "@/server/lib/http";
import { managementReports } from "@/server/modules/reports/service";

export const GET = route({ auth: true }, async ({ session }) => ok(await managementReports(getDb(), session!.actor)));
