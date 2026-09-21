import Link from "next/link";
import { getDb } from "@/server/db/client";
import { requirePageSession } from "@/server/lib/page-session";
import { can } from "@/server/modules/authz/policy";
import { executiveView } from "@/server/modules/analytics/service";
import { PLATFORM_STATUS_LABEL } from "@/components/labels";
import { Empty, fmtDate, PageHeader, StageBadge, Stars } from "@/components/ui";

type Row = { id: string; title: string; stageKey: string; stageName: string | null; badge: string | null; ownerName: string | null; creatorName: string; priority: string; rating: number | null; days: number };

function Rows({ rows, tab = "workflow" }: { rows: Row[]; tab?: string }) {
  if (!rows.length) return <Empty>None.</Empty>;
  return (
    <div className="table-wrap"><table className="data">
      <thead><tr><th>Pitch</th><th>Creator</th><th>Status</th><th>With</th><th>Priority</th><th>Rating</th><th>Waiting</th></tr></thead>
      <tbody>{rows.map((p) => <tr key={p.id}><td><Link href={`/pitches/${p.id}?tab=${tab}`}>{p.title}</Link></td><td>{p.creatorName}</td>
        <td><StageBadge badge={p.badge} label={p.stageName ?? p.stageKey} /></td><td>{p.ownerName ?? "—"}</td><td>{p.priority}</td><td><Stars value={p.rating} /></td><td>{p.days} d</td></tr>)}</tbody>
    </table></div>
  );
}

export default async function ManagementPage() {
  const { actor } = await requirePageSession();
  if (!can(actor, "pitch.view_all")) return <p className="notice">Management only.</p>;
  const v = await executiveView(getDb(actor), actor);
  return (
    <>
      <PageHeader title="Management Desk" subtitle="Decisions waiting, strongest stories, platform responses and the pipeline after approval." />
      <section className="section"><h2>Waiting for final sign-off ({v.pendingApprovals.length})</h2><Rows rows={v.pendingApprovals} /></section>
      <div className="grid-2">
        <section className="section"><h2>Recommended by reviewers</h2><Rows rows={v.recommended} /></section>
        <section className="section"><h2>High priority</h2><Rows rows={v.highPriority} tab="overview" /></section>
        <section className="section"><h2>Strongly rated (4★+)</h2><Rows rows={v.stronglyRated} tab="ratings" /></section>
        <section className="section"><h2>Platform-ready (approved, not yet pitched)</h2><Rows rows={v.platformReady} tab="platforms" /></section>
      </div>
      <section className="section"><h2>Latest platform responses</h2>
        {v.platformResponsesRecent.length === 0 ? <Empty>None yet.</Empty> : <table className="data"><thead><tr><th>Date</th><th>Pitch</th><th>Platform</th><th>Response</th><th>Recorded by</th></tr></thead>
          <tbody>{v.platformResponsesRecent.map((r, i) => <tr key={i}><td>{fmtDate(r.date)}</td><td><Link href={`/pitches/${r.pitchId}?tab=platforms`}>{r.title}</Link></td><td>{r.platform}</td><td>{PLATFORM_STATUS_LABEL[r.status]}</td><td>{r.recordedBy}</td></tr>)}</tbody></table>}
      </section>
      <section className="section"><h2>Development pipeline</h2><Rows rows={v.developmentPipeline} tab="development" /></section>
      <section className="section"><h2>Production pipeline</h2><Rows rows={v.productionPipeline} tab="production" /></section>
    </>
  );
}
