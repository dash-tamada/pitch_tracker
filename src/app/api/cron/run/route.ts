import { and, isNull, notInArray } from "drizzle-orm";
import { NextResponse, type NextRequest } from "next/server";
import { getPlatformDb, tenantDb, withCompany } from "@/server/db/client";
import { companies } from "@/server/db/schema";
import { safeEqual } from "@/server/modules/auth/tokens";
import { getEmail } from "@/server/modules/jobs/email";
import { agingAlerts, followUpReminders, identityCleanup, processOutbox, reconcileProjections, retentionCleanup } from "@/server/modules/jobs/runner";
import { getStorage } from "@/server/modules/storage";

/**
 * Scheduled job endpoint (e.g. Vercel Cron or any scheduler). Server-to-server only:
 * requires `Authorization: Bearer <CRON_SECRET>`; no browser session, cookies are ignored.
 * Jobs run company by company, each with its own company-scoped database handle.
 */
/** 20:30 UTC = 02:00 IST. Must match vercel.json. */
const DAILY_SCHEDULE = "30 20 * * *";

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization") ?? "";
  if (!secret || secret.length < 32 || !safeEqual(auth, `Bearer ${secret}`)) return new NextResponse(null, { status: 401 });
  // Vercel sends the triggering expression in x-vercel-cron-schedule; other schedulers can pass ?task=daily.
  const task = req.headers.get("x-vercel-cron-schedule") === DAILY_SCHEDULE || req.nextUrl.searchParams.get("task") === "daily" ? "daily" : "frequent";
  const platform = getPlatformDb();
  const list = await platform.select({ id: companies.id }).from(companies)
    .where(and(isNull(companies.archivedAt), notInArray(companies.status, ["ARCHIVED"])));
  let ok = 0, failed = 0;
  for (const c of list) {
    try {
      await withCompany(c.id, async () => {
        const db = tenantDb(c.id);
        await processOutbox(db, getEmail());
        if (task === "daily") {
          await followUpReminders(db);
          await agingAlerts(db);
          await reconcileProjections(db);
          await retentionCleanup(db, getStorage());
        }
      });
      ok++;
    } catch (e) {
      failed++;
      // One company's failure must not stop the others. No company data in logs.
      console.error(JSON.stringify({ level: "error", event: "cron.company_failed", name: e instanceof Error ? e.name : "unknown" }));
    }
  }
  if (task === "daily") await identityCleanup(platform).catch(() => { failed++; });
  return NextResponse.json({ companies: list.length, ok, failed }, { status: failed ? 500 : 200, headers: { "Cache-Control": "no-store" } });
}
