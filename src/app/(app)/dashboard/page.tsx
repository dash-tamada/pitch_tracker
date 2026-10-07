import Link from "next/link";
import { getDb } from "@/server/db/client";
import { requirePageSession } from "@/server/lib/page-session";
import { can } from "@/server/modules/authz/policy";
import { agingPitches, breakdowns, dashboardSummary, funnel, myWork, timeMetrics } from "@/server/modules/analytics/service";
import { getLookups, labelOf } from "@/server/modules/lookups/service";
import { Funnel, GroupedMonthChart, HBarChart } from "@/components/charts";
import { ACTION_LABEL } from "@/components/labels";
import { Empty, fmtDate, StageBadge, Stat } from "@/components/ui";
import { HeroBanner } from "@/components/hero-banner";
import { companyBranding } from "@/server/modules/tenancy/company";

export default async function DashboardPage() {
  const { actor } = await requirePageSession();
  const db = getDb(actor);
  const management = can(actor, "pitch.view_all") || can(actor, "analytics.view");
  const [s, f, me, lookups, brand] = await Promise.all([dashboardSummary(db, actor), funnel(db, actor), myWork(db, actor), getLookups(db), companyBranding(db)]);
  const [b, t, aging] = management ? await Promise.all([breakdowns(db, actor), timeMetrics(db, actor), agingPitches(db, actor)]) : [null, null, null];

  return (
    <div className="dash">
      <HeroBanner name={brand?.name ?? "This studio"} canCreate={can(actor, "pitch.create")} />
      {/* The four numbers people act on, then the whole pipeline as one strip read left to right —
          instead of thirteen equal tiles that made every number look equally important. */}
      <div className="kpis">
        <Stat label="Total pitches" value={s.total} />
        <Stat label="New this month" value={s.newThisMonth} />
        <Stat label="Under review" value={s.underReview} />
        <Link className={s.awaitingMyReview > 0 ? "card kpi-link is-due" : "card kpi-link"} href="/reviews">
          <div className="label">Awaiting my review</div>
          <div className="value">{s.awaitingMyReview}</div>
          <div className="kpi-cta">{s.awaitingMyReview > 0 ? "Review now →" : "All caught up"}</div>
        </Link>
      </div>

      <section className="section pipeline-panel" aria-labelledby="pipeline-h">
        <div className="panel-head">
          <h2 id="pipeline-h">Pipeline</h2>
          <span className="muted">Where every story is right now</span>
        </div>
        <ol className="pipeline">
          {[
            ["Accepted", s.accepted, "Recommended by a reviewer at least once"],
            ["Sent to platforms", s.sentToPlatforms, null],
            ["Platform approved", s.platformApproved, null],
            ["Ready for development", s.readyForDevelopment, null],
            ["In development", s.inDevelopment, null],
            ["Greenlit", s.greenlit, null],
            ["In production", s.inProduction, null],
            ["Completed", s.completed, null],
          ].map(([label, n, hint]) => (
            <li key={label as string} className={(n as number) > 0 ? "pl-stage" : "pl-stage is-empty"} title={(hint as string | null) ?? undefined}>
              <span className="pl-n">{n as number}</span>
              <span className="pl-l">{label as string}</span>
            </li>
          ))}
        </ol>
        <p className="pipeline-foot"><span className="pl-dot" aria-hidden="true" /> Rejected <b>{s.rejected}</b></p>
      </section>

      <div className="grid-2 dash-panels">
        <div className="section">
          <h2>Items requiring my action ({me.requiringAction})</h2>
          {me.pending.length === 0 && me.followUps.length === 0 ? <p className="muted">Nothing waiting for you.</p> : (
            <table className="data"><tbody>
              {me.pending.map((p) => <tr key={p.id}><td><Link href={`/pitches/${p.id}?tab=workflow`}>{p.title}</Link></td><td><StageBadge badge={p.badge} label={p.stageName ?? p.stageKey} /></td><td className="nowrap muted">{p.days} d</td></tr>)}
              {me.followUps.map((fu) => <tr key={fu.id}><td><Link href={`/pitches/${fu.pitchId}?tab=platforms`}>{fu.title}</Link></td><td>Follow up · {fu.platformName}</td><td>{fu.overdue ? "Overdue" : "Today"}</td></tr>)}
            </tbody></table>
          )}
        </div>
        <div className="section">
          <h2>Recent activity</h2>
          {me.activity.length === 0 ? <p className="muted">No activity.</p> : (
            <table className="data compact"><tbody>{me.activity.slice(0, 8).map((a, i) => <tr key={i}><td><Link href={`/pitches/${a.pitchId}`}>{a.title}</Link></td><td>{ACTION_LABEL[a.action] ?? a.action}</td><td className="nowrap muted">{a.by}</td><td className="nowrap muted">{fmtDate(a.at)}</td></tr>)}</tbody></table>
          )}
        </div>
      </div>

      <Funnel steps={f} />

      {b && t && aging && (
        <>
          <div className="kpis">
            <Stat label="Avg review time" value={t.reviewTime !== null ? `${t.reviewTime} d` : "—"} hint="Average days a pitch waits at a review stage before the next decision" />
            <Stat label="Submission → platform" value={t.submissionToPlatform !== null ? `${t.submissionToPlatform} d` : "—"} />
            <Stat label="Platform approval → development" value={t.platformApprovalToDevelopment !== null ? `${t.platformApprovalToDevelopment} d` : "—"} />
            <Stat label="Development → production" value={t.developmentToProduction !== null ? `${t.developmentToProduction} d` : "—"} />
          </div>
          <div className="grid-2">
            <GroupedMonthChart title="Pitches by month" data={b.byMonth} series={[{ key: "count", label: "Submitted", cls: "bar" }]} />
            <GroupedMonthChart title="Accepted vs rejected" data={b.decisionsByMonth} series={[{ key: "accepted", label: "Accepted", cls: "bar3" }, { key: "rejected", label: "Rejected", cls: "bar2" }, { key: "approved", label: "Approved", cls: "bar" }]} />
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
    </div>
  );
}
