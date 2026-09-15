import Link from "next/link";
import { getDb } from "@/server/db/client";
import { requirePageSession } from "@/server/lib/page-session";
import { myWork } from "@/server/modules/analytics/service";
import { ACTION_LABEL } from "@/components/labels";
import { Empty, fmtDate, PageHeader, StageBadge } from "@/components/ui";

type Row = { id: string; title: string; stageKey: string; stageName: string | null; badge: string | null; ownerName: string | null; updatedAt: Date; days?: number };

function Table({ rows, showOwner }: { rows: Row[]; showOwner?: boolean }) {
  if (!rows.length) return <Empty>None.</Empty>;
  return (
    <div className="table-wrap"><table className="data">
      <thead><tr><th>Pitch</th><th>Status</th>{showOwner && <th>With</th>}<th>Waiting</th><th>Updated</th></tr></thead>
      <tbody>{rows.map((p) => <tr key={p.id}><td><Link href={`/pitches/${p.id}?tab=workflow`}>{p.title}</Link></td><td><StageBadge badge={p.badge} label={p.stageName ?? p.stageKey} /></td>
        {showOwner && <td>{p.ownerName ?? "—"}</td>}<td>{p.days !== undefined ? `${p.days} d` : "—"}</td><td>{fmtDate(p.updatedAt)}</td></tr>)}</tbody>
    </table></div>
  );
}

export default async function ReviewsPage() {
  const { actor } = await requirePageSession();
  const w = await myWork(getDb(), actor);
  return (
    <>
      <PageHeader title="My Reviews" subtitle="Everything assigned to you, everything you passed on, and what came back." />
      <section className="section"><h2>My pending reviews ({w.pending.length})</h2><Table rows={w.pending} /></section>
      <section className="section"><h2>Stories assigned to me</h2><Table rows={w.assigned} /></section>
      <section className="section"><h2>Requests for changes</h2><Table rows={w.changesRequested} showOwner /></section>
      <section className="section"><h2>Stories I forwarded — now awaiting others</h2><Table rows={w.awaitingOthers} showOwner /></section>
      <section className="section"><h2>Platform follow-ups due</h2>
        {w.followUps.length === 0 ? <Empty>None due.</Empty> : <table className="data"><tbody>{w.followUps.map((f) => <tr key={f.id}><td><Link href={`/pitches/${f.pitchId}?tab=platforms`}>{f.title}</Link></td><td>{f.platformName}</td><td>{fmtDate(f.dueOn)}{f.overdue ? " · overdue" : ""}</td></tr>)}</tbody></table>}
      </section>
      <div className="grid-2">
        <section className="section"><h2>Recently approved</h2>{w.recentlyApproved.length === 0 ? <Empty>None.</Empty> : <table className="data"><tbody>{w.recentlyApproved.map((d, i) => <tr key={i}><td><Link href={`/pitches/${d.pitchId}`}>{d.title}</Link></td><td>{ACTION_LABEL[d.action]}</td><td>{d.by}</td><td>{fmtDate(d.at)}</td></tr>)}</tbody></table>}</section>
        <section className="section"><h2>Recently rejected</h2>{w.recentlyRejected.length === 0 ? <Empty>None.</Empty> : <table className="data"><tbody>{w.recentlyRejected.map((d, i) => <tr key={i}><td><Link href={`/pitches/${d.pitchId}`}>{d.title}</Link></td><td>{d.by}</td><td>{fmtDate(d.at)}</td></tr>)}</tbody></table>}</section>
      </div>
    </>
  );
}
