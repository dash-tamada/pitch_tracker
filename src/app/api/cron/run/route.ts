import { NextResponse, type NextRequest } from "next/server";
import { getDb } from "@/server/db/client";
import { safeEqual } from "@/server/modules/auth/tokens";
import { getEmail } from "@/server/modules/jobs/email";
import { agingAlerts, followUpReminders, processOutbox, reconcileProjections, retentionCleanup } from "@/server/modules/jobs/runner";
import { getStorage } from "@/server/modules/storage";

/**
 * Scheduled job endpoint (e.g. Vercel Cron or any scheduler). Server-to-server only:
 * requires `Authorization: Bearer <CRON_SECRET>`; no browser session, cookies are ignored.
 */
/** 20:30 UTC = 02:00 IST. Must match vercel.json. */
const DAILY_SCHEDULE = "30 20 * * *";

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization") ?? "";
  if (!secret || secret.length < 32 || !safeEqual(auth, `Bearer ${secret}`)) return new NextResponse(null, { status: 401 });
  const db = getDb();
  // Vercel sends the triggering expression in x-vercel-cron-schedule; other schedulers can pass ?task=daily.
  const task = req.headers.get("x-vercel-cron-schedule") === DAILY_SCHEDULE || req.nextUrl.searchParams.get("task") === "daily" ? "daily" : "frequent";
  try {
    const result: Record<string, unknown> = { outbox: await processOutbox(db, getEmail()) };
    if (task === "daily") {
      result.followUps = await followUpReminders(db);
      result.aging = await agingAlerts(db);
      result.reconcile = await reconcileProjections(db);
      result.retention = await retentionCleanup(db, getStorage());
    }
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    console.error(JSON.stringify({ level: "error", event: "cron.failed", name: e instanceof Error ? e.name : "unknown" }));
    return NextResponse.json({ error: "job failed" }, { status: 500 });
  }
}
