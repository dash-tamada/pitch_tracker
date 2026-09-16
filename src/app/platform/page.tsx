import { getPlatformDb } from "@/server/db/client";
import { requirePlatformPageSession } from "@/server/lib/page-session";
import { platformOverview } from "@/server/modules/platform/service";
import { PageHeader, Stat } from "@/components/ui";

export default async function PlatformOverviewPage() {
  const { actor } = await requirePlatformPageSession();
  const o = await platformOverview(getPlatformDb(), actor);
  const t = o.totals as { companies: number; companies_active: number; users_active: number; pitches: number; storage_bytes: string };
  return (
    <>
      <PageHeader title="Platform overview" subtitle="Counts only. Company content stays inside each company." />
      <div className="cards">
        <Stat label="Companies" value={t.companies} />
        <Stat label="Active / trial" value={t.companies_active} />
        <Stat label="Active users" value={t.users_active} />
        <Stat label="Pitches (all companies)" value={t.pitches} />
        <Stat label="Storage used" value={`${(Number(t.storage_bytes) / 1024 ** 3).toFixed(2)} GB`} />
      </div>
      <section className="section"><h2>Companies by status</h2>
        <ul>{o.byStatus.map((s) => <li key={s.status}>{s.status.replaceAll("_", " ")}: {s.n}</li>)}</ul>
      </section>
    </>
  );
}
