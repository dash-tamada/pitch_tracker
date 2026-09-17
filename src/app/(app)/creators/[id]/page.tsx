import Link from "next/link";
import { getDb } from "@/server/db/client";
import { pageData, requirePageSession } from "@/server/lib/page-session";
import { can } from "@/server/modules/authz/policy";
import { creatorActivity, creatorPitches, creatorPlatformHistory, getCreatorProfile } from "@/server/modules/creators/service";
import { canSeeRatings, creatorRatings } from "@/server/modules/ratings/service";
import { getActiveStages, getLookups, getPlatformOptions, labelOf, userNames } from "@/server/modules/lookups/service";
import { AddProjectForm, ArchiveCreatorButton } from "@/components/creator-actions";
import { ACTION_LABEL, PLATFORM_STATUS_LABEL, typeLabel } from "@/components/labels";
import { Empty, fmtDate, fmtDateTime, PageHeader, StageBadge, Stars, Stat, Tabs } from "@/components/ui";

const TABS = [
  { key: "overview", label: "Overview" }, { key: "pitches", label: "Pitches" }, { key: "projects", label: "Projects" },
  { key: "ratings", label: "Ratings" }, { key: "platforms", label: "Platform History" }, { key: "documents", label: "Documents" },
  { key: "activity", label: "Activity" },
];

export default async function CreatorProfilePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string }> }) {
  const { actor } = await requirePageSession();
  const { id } = await params;
  const requested = (await searchParams).tab;
  const tab = TABS.some((t) => t.key === requested) ? requested! : "overview";
  const db = getDb(actor);
  const profile = await pageData(() => getCreatorProfile(db, actor, id));
  if (!profile) return <p className="notice">You do not have access to creators.</p>;
  const { creator: c, projects, stats } = profile;
  const [lookups, stages, ratingsVisible] = await Promise.all([getLookups(db), getActiveStages(db), canSeeRatings(db, actor)]);
  const stageOf = (k: string) => stages.find((s) => s.key === k);
  const ratings = ratingsVisible ? await creatorRatings(db, actor, id) : null;

  return (
    <>
      <PageHeader title={c.fullName}
        subtitle={<>{typeLabel(c.creatorType)} · {c.location ?? "Location not set"} {c.archived && <span className="badge b-rejected">Archived</span>}</>}
        actions={<>
          {can(actor, "creator.edit") && <Link className="btn-secondary" href={`/creators/${id}/edit`}>Edit</Link>}
          {can(actor, "creator.archive") && <ArchiveCreatorButton id={id} archived={c.archived} />}
          {can(actor, "pitch.create") && <Link className="btn-inline" href={`/pitches/new?creatorId=${id}`}>+ New pitch</Link>}
        </>} />
      <div className="grid-2">
        <dl className="kv section">
          <dt>Mobile</dt><dd>{c.mobile ?? "—"}</dd>
          <dt>Email</dt><dd>{c.email ?? "—"}</dd>
          <dt>Rating</dt><dd>{ratings ? <><Stars value={ratings.average} /> <span className="muted">({ratings.count} reviews)</span></> : <span className="muted">Management only</span>}</dd>
          <dt>Languages</dt><dd>{c.languageKeys.map((k) => labelOf(lookups, "LANGUAGE", k)).join(", ") || "—"}</dd>
          <dt>Experience</dt><dd>{c.yearsExperience ?? "—"} years</dd>
        </dl>
        <dl className="kv section">
          <dt>Agency</dt><dd>{c.agency ?? "—"}</dd>
          <dt>Website</dt><dd>{c.website ? <a href={c.website} rel="noopener noreferrer nofollow" target="_blank">{c.website}</a> : "—"}</dd>
          <dt>Previous companies</dt><dd>{c.previousCompanies.join(", ") || "—"}</dd>
          <dt>Consent basis</dt><dd>{c.consentBasis ?? "Not recorded"}</dd>
          {c.piiMasked && <><dt>Note</dt><dd className="muted">Contact details are masked for your role.</dd></>}
        </dl>
      </div>

      <Tabs base={`/creators/${id}`} current={tab} tabs={TABS} />

      {tab === "overview" && (
        <>
          <div className="cards">
            <Stat label="Total pitches" value={stats.total} />
            <Stat label="Under review" value={stats.underReview} />
            <Stat label="Forwarded" value={stats.forwarded} hint="Pitches forwarded or accepted by a reviewer at least once" />
            <Stat label="Accepted" value={stats.accepted} hint="Pitches a reviewer accepted and recommended" />
            <Stat label="CEO/COO approved" value={stats.approved} />
            <Stat label="Rejected" value={stats.rejected} />
            <Stat label="Sent to platforms" value={stats.sentToPlatforms} />
            <Stat label="Platform approved" value={stats.platformApproved} />
            <Stat label="Platform rejected" value={stats.platformRejected} />
            <Stat label="Development" value={stats.development} />
            <Stat label="Greenlit" value={stats.greenlit} />
            <Stat label="Production" value={stats.production} />
            <Stat label="Completed" value={stats.completed} />
          </div>
          <div className="section">
            <h2>Success rates</h2>
            <dl className="kv">
              <dt>CEO/COO approval</dt><dd>{stats.rates.approvalRate ?? "—"}{stats.rates.approvalRate !== null && "%"} <span className="muted">of all pitches</span></dd>
              <dt>Platform approval</dt><dd>{stats.rates.platformApprovalRate ?? "—"}{stats.rates.platformApprovalRate !== null && "%"} <span className="muted">of pitches sent to platforms</span></dd>
              <dt>Reached production</dt><dd>{stats.rates.productionRate ?? "—"}{stats.rates.productionRate !== null && "%"} <span className="muted">of all pitches</span></dd>
            </dl>
            <p className="subtle">Counts include only pitches you are allowed to see.</p>
          </div>
          {c.bio && <div className="section"><h2>Bio</h2><p>{c.bio}</p></div>}
          {c.notes && <div className="section"><h2>Internal notes</h2><p>{c.notes}</p></div>}
        </>
      )}

      {tab === "pitches" && <PitchesTab rows={await creatorPitches(db, actor, id)} stageOf={stageOf} lookups={lookups} />}

      {tab === "projects" && (
        <>
          {can(actor, "creator.edit") && <AddProjectForm creatorId={id} />}
          {projects.length === 0 ? <Empty>No projects recorded.</Empty> : (
            <div className="table-wrap"><table className="data">
              <thead><tr><th>Project</th><th>Role</th><th>Company</th><th>Platform</th><th>Year</th><th>Status</th></tr></thead>
              <tbody>{projects.map((p) => (
                <tr key={p.id}><td><strong>{p.projectName}</strong>{p.description && <div className="muted">{p.description}</div>}</td>
                  <td>{typeLabel(p.role)}</td><td>{p.productionCompany ?? "—"}</td><td>{p.platformName ?? "—"}</td><td>{p.releaseYear ?? "—"}</td><td>{p.projectStatus ?? "—"}</td></tr>
              ))}</tbody>
            </table></div>
          )}
        </>
      )}

      {tab === "ratings" && (!ratings ? <p className="notice">Ratings are visible to management only.</p> : (
        <>
          <div className="cards">
            <Stat label="Average rating" value={ratings.average ?? "—"} />
            <Stat label="Reviews" value={ratings.count} />
            {ratings.byCategory.map((b) => <Stat key={b.key} label={b.label} value={b.average} hint={`${b.count} scores`} />)}
          </div>
          {ratings.trend.length > 0 && (
            <div className="section"><h2>Rating trend</h2>
              <table className="data"><thead><tr><th>Month</th><th>Average</th><th>Reviews</th></tr></thead>
                <tbody>{ratings.trend.map((t) => <tr key={t.month}><td>{t.month}</td><td><Stars value={t.average} /></td><td>{t.count}</td></tr>)}</tbody></table>
            </div>
          )}
          <div className="table-wrap"><table className="data">
            <thead><tr><th>Date</th><th>Pitch</th><th>Reviewer</th><th>Overall</th><th>Scores</th><th>Comments</th></tr></thead>
            <tbody>{ratings.history.map((r) => (
              <tr key={r.id}><td>{fmtDate(r.createdAt)}</td><td><Link href={`/pitches/${r.pitchId}`}>{r.pitchTitle}</Link></td><td>{r.reviewerName}</td>
                <td><Stars value={r.overall} /></td><td>{r.scores.map((s) => `${s.key}: ${s.score}`).join(", ") || "—"}</td><td>{r.comments ?? ""}</td></tr>
            ))}</tbody>
          </table></div>
        </>
      ))}

      {tab === "platforms" && <PlatformTab rows={await creatorPlatformHistory(db, actor, id)} platforms={await getPlatformOptions(db, true)} />}

      {tab === "documents" && <p className="subtle">Scripts and documents are kept on each pitch. Open a pitch from the Pitches tab to see its documents (access is checked per pitch and every download is logged).</p>}

      {tab === "activity" && <ActivityLoader actor={actor} id={id} />}
    </>
  );
}

function PitchesTab({ rows, stageOf, lookups }: { rows: Awaited<ReturnType<typeof creatorPitches>>; stageOf: (k: string) => { name: string; badge: string | null } | undefined; lookups: Awaited<ReturnType<typeof getLookups>> }) {
  if (!rows.length) return <Empty>No pitches you can see.</Empty>;
  return (
    <div className="table-wrap"><table className="data">
      <thead><tr><th>Pitch</th><th>Format</th><th>Language</th><th>Status</th><th>Since</th></tr></thead>
      <tbody>{rows.map((p) => (
        <tr key={p.id}><td><Link href={`/pitches/${p.id}`}>{p.title}</Link><div className="muted">{p.pitchCode}</div></td>
          <td>{labelOf(lookups, "FORMAT", p.formatKey)}</td><td>{labelOf(lookups, "LANGUAGE", p.languageKey)}</td>
          <td><StageBadge badge={stageOf(p.currentStageKey)?.badge} label={stageOf(p.currentStageKey)?.name ?? p.currentStageKey} /></td>
          <td>{fmtDate(p.stageEnteredAt)}</td></tr>
      ))}</tbody>
    </table></div>
  );
}

function PlatformTab({ rows, platforms }: { rows: Awaited<ReturnType<typeof creatorPlatformHistory>>; platforms: { id: string; name: string }[] }) {
  if (!rows.length) return <Empty>No platform pitches yet.</Empty>;
  return (
    <div className="table-wrap"><table className="data">
      <thead><tr><th>Date</th><th>Pitch</th><th>Platform</th><th>Status</th></tr></thead>
      <tbody>{rows.map((r) => (
        <tr key={r.platformPitchId}><td>{fmtDate(r.pitchDate)}</td><td><Link href={`/pitches/${r.pitchId}?tab=platforms`}>{r.title}</Link></td>
          <td>{platforms.find((p) => p.id === r.platformId)?.name ?? "—"}</td><td>{PLATFORM_STATUS_LABEL[r.status] ?? r.status}</td></tr>
      ))}</tbody>
    </table></div>
  );
}

function ActivityTab({ rows, names }: { rows: Awaited<ReturnType<typeof creatorActivity>>; names: Map<string, string> }) {
  if (!rows.length) return <Empty>No activity yet.</Empty>;
  return (
    <div className="table-wrap"><table className="data">
      <thead><tr><th>When</th><th>Pitch</th><th>What happened</th><th>By</th></tr></thead>
      <tbody>{rows.map((a, i) => (
        <tr key={i}><td>{fmtDateTime(a.createdAt)}</td><td><Link href={`/pitches/${a.pitchId}`}>{a.title}</Link></td>
          <td>{ACTION_LABEL[a.action] ?? a.action}</td><td>{a.actorId ? (names.get(a.actorId) ?? "—") : "Creator (self-submitted)"}</td></tr>
      ))}</tbody>
    </table></div>
  );
}

async function ActivityLoader({ actor, id }: { actor: Parameters<typeof creatorActivity>[1]; id: string }) {
  const db = getDb(actor);
  const rows = await creatorActivity(db, actor, id);
  return <ActivityTab rows={rows} names={await userNames(db, rows.map((a) => a.actorId))} />;
}
