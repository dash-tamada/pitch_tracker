import Link from "next/link";
import { getDb } from "@/server/db/client";
import { requirePageSession } from "@/server/lib/page-session";
import { can } from "@/server/modules/authz/policy";
import { agingPitches, breakdowns, dashboardSummary, funnel, myWork, timeMetrics } from "@/server/modules/analytics/service";
import { getLookups, labelOf } from "@/server/modules/lookups/service";
import { Funnel, GroupedMonthChart, HBarChart } from "@/components/charts";
import { ACTION_LABEL } from "@/components/labels";
import { Empty, fmtDate, PageHeader, StageBadge, Stat } from "@/components/ui";

export default async function DashboardPage() {
  const { actor } = await requirePageSession();
  const db = getDb();
  const management = can(actor, "pitch.view_all") || can(actor, "analytics.view");
  const [s, f, me, lookups] = await Promise.all([dashboardSummary(db, actor), funnel(db, actor), myWork(db, actor), getLookups(db)]);
  const [b, t, aging] = management ? await Promise.all([breakdowns(db, actor), timeMetrics(db, actor), agingPitches(db, actor)]) : [null, null, null];

  return (
    <>
      <PageHeader title="Dashboard" subtitle={management ? "The whole story pipeline you are cleared to see." : "Your stories and what needs your attention."} />
      <div className="cards">
        <Stat label="Total pitches" value={s.total} />
        <Stat label="New (this month)" value={s.newThisMonth} />
        <Stat label="Under review" value={s.underReview} />
        <Stat label="Awaiting my review" value={<Link href="/reviews">{s.awaitingMyReview}</Link>} />
        <Stat label="Awaiting CEO approval" value={s.awaitingCeo} />
        <Stat label="Awaiting COO approval" value={s.awaitingCoo} />
        <Stat label="Accepted" value={s.accepted} hint="Recommended by a reviewer at least once" />
        <Stat label="Rejected" value={s.rejected} />
        <Stat label="Sent to platforms" value={s.sentToPlatforms} />
        <Stat label="Platform approved" value={s.platformApproved} />
        <Stat label="👍 Ready for development" value={s.readyForDevelopment} />
        <Stat label="In development" value={s.inDevelopment} />
        <Stat label="Greenlit" value={s.greenlit} />
        <Stat label="🎬 In production" value={s.inProduction} />
        <Stat label="Completed" value={s.completed} />
      </div>

      <div className="grid-2">
        <div className="section">
          <h2>Items requiring my action ({me.requiringAction})</h2>
          {me.pending.length === 0 && me.followUps.length === 0 ? <p className="muted">Nothing waiting for you.</p> : (
            <table className="data"><tbody>
              {me.pending.map((p) => <tr key={p.id}><td><Link href={`/pitches/${p.id}?tab=workflow`}>{p.title}</Link></td><td><StageBadge badge={p.badge} label={p.stageName ?? p.stageKey} /></td><td>{p.days} d</td></tr>)}
              {me.followUps.map((fu) => <tr key={fu.id}><td><Link href={`/pitches/${fu.pitchId}?tab=platforms`}>{fu.title}</Link></td><td>Follow up · {fu.platformName}</td><td>{fu.overdue ? "Overdue" : "Today"}</td></tr>)}
            </tbody></table>
          )}
        </div>
        <div className="section">
          <h2>Recent activity</h2>
          {me.activity.length === 0 ? <p className="muted">No activity.</p> : (
            <table className="data"><tbody>{me.activity.map((a, i) => <tr key={i}><td><Link href={`/pitches/${a.pitchId}`}>{a.title}</Link></td><td>{ACTION_LABEL[a.action] ?? a.action}</td><td>{a.by}</td><td>{fmtDate(a.at)}</td></tr>)}</tbody></table>
          )}
        </div>
      </div>

      <Funnel steps={f} />

      {b && t && aging && (
        <>
          <div className="cards">
            <Stat label="Avg review time" value={t.reviewTime !== null ? `${t.reviewTime} d` : "—"} hint="Average days a pitch waits at a review or CEO/COO stage before the next decision" />
            <Stat label="Submission → platform" value={t.submissionToPlatform !== null ? `${t.submissionToPlatform} d` : "—"} />
            <Stat label="Platform approval → development" value={t.platformApprovalToDevelopment !== null ? `${t.platformApprovalToDevelopment} d` : "—"} />
            <Stat label="Development → production" value={t.developmentToProduction !== null ? `${t.developmentToProduction} d` : "—"} />
          </div>
          <div className="grid-2">
            <GroupedMonthChart title="Pitches by month" data={b.byMonth} series={[{ key: "count", label: "Submitted", cls: "bar" }]} />
            <GroupedMonthChart title="Accepted vs rejected" data={b.decisionsByMonth} series={[{ key: "accepted", label: "Accepted", cls: "bar3" }, { key: "rejected", label: "Rejected", cls: "bar2" }, { key: "approved", label: "CEO/COO approved", cls: "bar" }]} />
            <HBarChart title="Pitches by genre" data={b.byGenre.map((g) => ({ label: labelOf(lookups, "GENRE", g.key), value: g.count }))} />
            <HBarChart title="Pitches by language" data={b.byLanguage.map((g) => ({ label: labelOf(lookups, "LANGUAGE", g.key), value: g.count }))} />
            <HBarChart title="Pitches by platform" data={b.byPlatform.map((p) => ({ label: p.name, value: p.pitched }))} />
            <HBarChart title="Platform approval rate" valueSuffix="%" data={b.byPlatform.filter((p) => p.approvalRate !== null).map((p) => ({ label: p.name, value: p.approvalRate! }))} />
            <HBarChart title="Pitches by creator (top 15)" data={b.byCreator.map((c) => ({ label: c.name, value: c.total }))} />
            <HBarChart title="Creator approval rate" valueSuffix="%" data={b.byCreator.filter((c) => c.approvalRate !== null).map((c) => ({ label: c.name, value: c.approvalRate! }))} />
          </div>
          <div className="section">
            <h2>Aging / stuck pitches</h2>
            {aging.length === 0 ? <Empty>Nothing waiting beyond the attention threshold.</Empty> : (
              <table className="data"><thead><tr><th>Pitch</th><th>With</th><th>Stage</th><th>Waiting</th></tr></thead>
                <tbody>{aging.slice(0, 20).map((a) => <tr key={a.id}><td><Link href={`/pitches/${a.id}`}>{a.title}</Link></td><td>{a.ownerName ?? "—"}</td><td>{a.stageName}</td><td className={`aging-${a.level}`}>{a.days} days · {a.level}</td></tr>)}</tbody></table>
            )}
          </div>
        </>
      )}
    </>
  );
}
