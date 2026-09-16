import Link from "next/link";
import { getDb } from "@/server/db/client";
import { pageData, requirePageSession } from "@/server/lib/page-session";
import { developmentPipeline } from "@/server/modules/production/service";
import { Empty, fmtDate, PageHeader } from "@/components/ui";

export default async function DevelopmentPage() {
  const { actor } = await requirePageSession();
  const data = await pageData(() => developmentPipeline(getDb(actor), actor));
  if (!data) return <p className="notice">You do not have access to the development tracker.</p>;
  return (
    <>
      <PageHeader title="Development" subtitle="Platform-approved stories getting ready, and stories in development." />
      <section className="section"><h2>👍 Ready for development</h2>
        {data.ready.length === 0 ? <Empty>None.</Empty> : <table className="data"><thead><tr><th>Pitch</th><th>With</th><th>Since</th></tr></thead>
          <tbody>{data.ready.map((r) => <tr key={r.id}><td><Link href={`/pitches/${r.id}?tab=development`}>{r.title}</Link></td><td>{r.ownerName ?? "—"}</td><td>{fmtDate(r.stageEnteredAt)}</td></tr>)}</tbody></table>}
      </section>
      <section className="section"><h2>In development</h2>
        {data.active.length === 0 ? <Empty>None.</Empty> : <table className="data"><thead><tr><th>Pitch</th><th>Platform</th><th>Owner</th><th>Status</th><th>Start</th><th>Expected completion</th></tr></thead>
          <tbody>{data.active.map((r) => <tr key={r.id}><td><Link href={`/pitches/${r.id}?tab=development`}>{r.title}</Link></td><td>{r.platformName ?? "—"}</td><td>{r.ownerName}</td><td>{r.status.replaceAll("_", " ").toLowerCase()}</td><td>{fmtDate(r.startDate)}</td><td>{fmtDate(r.expectedCompletion)}</td></tr>)}</tbody></table>}
      </section>
    </>
  );
}
