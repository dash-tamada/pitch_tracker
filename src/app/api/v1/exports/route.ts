import { getDb } from "@/server/db/client";
import { queryObject, route } from "@/server/lib/http";
import { exportCsv } from "@/server/modules/reports/service";

/** GET so the browser can download directly; every export is permission-checked and audited server-side. */
export const GET = route({ auth: true, rateLimit: { limit: 10, windowMs: 60_000 } }, async ({ req, session, ctx }) => {
  const { filename, csv } = await exportCsv(getDb(), session!.actor, queryObject(req), ctx);
  return new Response(csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${filename}"`, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
});
