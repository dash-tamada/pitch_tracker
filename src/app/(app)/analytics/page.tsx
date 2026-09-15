import Link from "next/link";
import { getDb } from "@/server/db/client";
import { pageData, requirePageSession } from "@/server/lib/page-session";
import { can } from "@/server/modules/authz/policy";
import { managementReports } from "@/server/modules/reports/service";
import { HBarChart } from "@/components/charts";
import { Empty, PageHeader, Stat } from "@/components/ui";

const EXPORTS: [string, string][] = [["pitches", "Pitch list"], ["creators", "Creator list"], ["platforms", "Platform list"], ["platform_performance", "Platform performance"],
  ["rejections", "Rejection report"], ["approvals", "Approval report"], ["workflow", "Workflow report"], ["creator_performance", "Creator performance"]];

export default async function AnalyticsPage() {
  const { actor } = await requirePageSession();
  const r = await pageData(() => managementReports(getDb(), actor));
  if (!r) return <p className="notice">Reports are available to management.</p>;
  const s = r.summary;
  return (
    <>
      <PageHeader title="Analytics & Reports" subtitle="All figures are computed live from workflow history and include only pitches you are cleared to see." />
      {can(actor, "data.export") && (
        <section className="section"><h2>Export (CSV — opens in Excel)</h2>
          <p className="subtle">Every export is recorded in the audit log. Contact details are masked unless your role can see them. For PDF, use your browser’s Print → Save as PDF on this page.</p>
          <div className="chips">{EXPORTS.map(([k, l]) => <a key={k} className="btn-secondary" href={`/api/v1/exports?kind=${k}`}>{l}</a>)}</div>
        </section>
      )}
      <h2>Pitch report</h2>
      <div className="cards">
        <Stat label="Total" value={s.total} /><Stat label="New this month" value={s.newThisMonth} /><Stat label="Accepted" value={s.accepted} />
        <Stat label="Rejected" value={s.rejected} /><Stat label="Pending review" value={s.underReview + s.newPitches} />
      </div>
      <div className="grid-2">
        <HBarChart title="Pipeline — pitches at each stage" data={r.byStage.map((x) => ({ label: x.name ?? x.key, value: x.count }))} />
        <section className="section"><h2>Bottlenecks (aging by stage)</h2>
          {r.bottlenecks.length === 0 ? <Empty>No aging pitches.</Empty> : <table className="data"><thead><tr><th>Stage</th><th>Aging pitches</th><th>Longest wait</th></tr></thead>
            <tbody>{r.bottlenecks.map((b) => <tr key={b.stage}><td>{b.stage}</td><td>{b.count}</td><td>{b.maxDays} d</td></tr>)}</tbody></table>}
        </section>
      </div>
      <section className="section"><h2>Platform report</h2>
        <table className="data"><thead><tr><th>Platform</th><th>Pitches sent</th><th>Interested</th><th>Approved</th><th>Rejected</th><th>On hold</th><th>Approval rate</th></tr></thead>
          <tbody>{r.byPlatform.map((p) => <tr key={p.platformId}><td><Link href={`/platforms/${p.platformId}`}>{p.name}</Link></td><td>{p.pitched}</td><td>{p.interested}</td><td>{p.approved}</td><td>{p.rejected}</td><td>{p.onHold}</td><td>{p.approvalRate ?? "—"}{p.approvalRate !== null && "%"}</td></tr>)}</tbody></table>
      </section>
      <section className="section"><h2>Creator report</h2>
        <table className="data"><thead><tr><th>Creator</th><th>Pitches</th><th>CEO/COO approved</th><th>Approval rate</th></tr></thead>
          <tbody>{r.byCreator.map((c) => <tr key={c.creatorId}><td><Link href={`/creators/${c.creatorId}`}>{c.name}</Link></td><td>{c.total}</td><td>{c.approved}</td><td>{c.approvalRate ?? "—"}{c.approvalRate !== null && "%"}</td></tr>)}</tbody></table>
      </section>
      <section className="section"><h2>Employee report</h2>
        <table className="data"><thead><tr><th>Employee</th><th>Reviews completed</th><th>Avg review time</th><th>Acceptance rate</th><th>Rejection rate</th><th>Forwarded</th></tr></thead>
          <tbody>{r.employees.map((e) => <tr key={e.userId}><td>{e.name}</td><td>{e.reviews}</td><td>{e.avgReviewDays ?? "—"}{e.avgReviewDays !== null && " d"}</td><td>{e.acceptanceRate ?? "—"}{e.acceptanceRate !== null && "%"}</td><td>{e.rejectionRate ?? "—"}{e.rejectionRate !== null && "%"}</td><td>{e.forwarded}</td></tr>)}</tbody></table>
      </section>
      <section className="section"><h2>Aging stories</h2>
        {r.aging.length === 0 ? <Empty>None.</Empty> : <table className="data"><thead><tr><th>With</th><th>Pitch</th><th>Stage</th><th>Waiting</th></tr></thead>
          <tbody>{r.aging.map((a) => <tr key={a.id}><td>{a.ownerName ?? "—"}</td><td><Link href={`/pitches/${a.id}`}>{a.title}</Link></td><td>{a.stageName}</td><td className={`aging-${a.level}`}>{a.days} days · {a.level}</td></tr>)}</tbody></table>}
      </section>
    </>
  );
}
