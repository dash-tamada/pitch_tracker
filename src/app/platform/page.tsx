import Link from "next/link";
import { getPlatformDb } from "@/server/db/client";
import { requirePlatformPageSession } from "@/server/lib/page-session";
import { platformOverview } from "@/server/modules/platform/service";
import { PageHeader, Stat } from "@/components/ui";

/** Companies-by-status colourway, reusing the workflow badge classes so the console reads like the rest of the app. */
const STATUS_BADGE: Record<string, string> = {
  ACTIVE: "b-approved", TRIAL: "b-review", SUSPENDED: "b-rejected",
  EXPIRED: "b-rejected", CANCELLED: "b-hold", PENDING: "b-new",
};

export default async function PlatformOverviewPage() {
  const { actor } = await requirePlatformPageSession();
  const o = await platformOverview(getPlatformDb(), actor);
  const t = o.totals as { companies: number; companies_active: number; users_active: number; pitches: number; storage_bytes: string };
  return (
    <>
      <PageHeader title="Platform overview" subtitle="Counts only. Company content stays inside each company."
        actions={<Link className="btn-inline" href="/platform/companies">Manage companies</Link>} />
      <div className="cards">
        <Stat label="Companies" value={t.companies} />
        <Stat label="Active / trial" value={t.companies_active} />
        <Stat label="Active users" value={t.users_active} />
        <Stat label="Pitches (all companies)" value={t.pitches} />
        <Stat label="Storage used" value={`${(Number(t.storage_bytes) / 1024 ** 3).toFixed(2)} GB`} />
      </div>
      <section className="section">
        <h2>Companies by status</h2>
        {o.byStatus.length === 0 ? <p className="muted">No companies yet.</p> : (
          <ul className="status-list">
            {o.byStatus.map((s) => (
              <li key={s.status}>
                <span className={`badge ${STATUS_BADGE[s.status] ?? "b-new"}`}>{s.status.replaceAll("_", " ")}</span>
                <b>{s.n}</b>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
