import Link from "next/link";
import { getDb } from "@/server/db/client";
import { pageData, requirePageSession } from "@/server/lib/page-session";
import { productionPipeline } from "@/server/modules/production/service";
import { Empty, fmtDate, PageHeader } from "@/components/ui";

export default async function ProductionPage() {
  const { actor } = await requirePageSession();
  const rows = await pageData(() => productionPipeline(getDb(), actor));
  if (!rows) return <p className="notice">You do not have access to the production tracker.</p>;
  return (
    <>
      <PageHeader title="Production" subtitle="Greenlit stories through pre-production, production, post-production and release." />
      {rows.length === 0 ? <Empty>Nothing greenlit yet.</Empty> : (
        <div className="table-wrap"><table className="data">
          <thead><tr><th>Pitch</th><th>Status</th><th>Owner</th><th>Company</th><th>Platform</th><th>Start</th><th>Expected release</th><th>Released</th><th>Budget</th></tr></thead>
          <tbody>{rows.map((r) => <tr key={r.id}><td><Link href={`/pitches/${r.id}?tab=production`}>{r.title}</Link></td><td>{r.status.replaceAll("_", " ").toLowerCase()}</td><td>{r.ownerName}</td>
            <td>{r.productionCompany ?? "—"}</td><td>{r.platformName ?? "—"}</td><td>{fmtDate(r.startDate)}</td><td>{fmtDate(r.expectedRelease)}</td><td>{fmtDate(r.actualRelease)}</td>
            <td>{r.budgetRupees !== null ? `₹${r.budgetRupees.toLocaleString("en-IN")}` : "—"}</td></tr>)}</tbody>
        </table></div>
      )}
    </>
  );
}
