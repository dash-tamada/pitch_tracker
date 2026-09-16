import Link from "next/link";
import { getDb } from "@/server/db/client";
import { pageData, requirePageSession } from "@/server/lib/page-session";
import { can, type Actor } from "@/server/modules/authz/policy";
import { getCreatorProfile } from "@/server/modules/creators/service";
import { listPitchDocuments, listPitchImages, pitchDownloadLog } from "@/server/modules/documents/service";
import { getActiveStages, getLookups, getPlatformOptions, getRatingCategories, labelOf, userNames, type LookupMap } from "@/server/modules/lookups/service";
import { getPitchDetail } from "@/server/modules/pitches/service";
import { pitchPlatformPitches } from "@/server/modules/platforms/service";
import { pitchDevelopmentAndProduction } from "@/server/modules/production/service";
import { canSeeRatings } from "@/server/modules/ratings/service";
import { getStorage } from "@/server/modules/storage";
import { getAvailableActions, getTimeline, TRACKER_ACTIONS } from "@/server/modules/workflow/engine";
import { ActionForm, type FieldSpec } from "@/components/action-form";
import { ACTION_LABEL, PLATFORM_STATUS_LABEL, typeLabel } from "@/components/labels";
import { UploadPanel } from "@/components/upload-panel";
import { ViewInPopupButton } from "@/components/view-in-popup-button";
import { Empty, fmtDate, fmtDateTime, StageBadge, Stars, Tabs } from "@/components/ui";
import { RatingCategoryForm } from "@/components/rating-form";

const TABS = [
  { key: "overview", label: "Overview" }, { key: "documents", label: "Script & Documents" }, { key: "workflow", label: "Workflow" },
  { key: "remarks", label: "Remarks" }, { key: "platforms", label: "Platform Pitches" }, { key: "creator", label: "Creator" },
  { key: "projects", label: "Projects" }, { key: "ratings", label: "Ratings" }, { key: "images", label: "Images" },
  { key: "development", label: "Development" }, { key: "production", label: "Production" }, { key: "activity", label: "Activity Log" },
];

export default async function PitchDetailPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { actor } = await requirePageSession();
  const { id } = await params;
  const sp = await searchParams;
  const tab = TABS.some((t) => t.key === sp.tab) ? sp.tab! : "overview";
  const db = getDb(actor);
  const d = await pageData(() => getPitchDetail(db, actor, id));
  if (!d) return <p className="notice">You do not have access to this pitch.</p>;
  const { pitch: p, status: s, creator } = d;
  const lookups = await getLookups(db);

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">{p.title}</h1>
          <p className="subtle">{p.pitchCode} · {typeLabel(creator.type)}: <Link href={`/creators/${creator.id}`}>{creator.name}</Link> · Priority {p.priority} · {p.confidentiality}</p>
        </div>
        <div className="head-actions">
          {can(actor, "pitch.edit") && !d.archived && <Link className="btn-secondary" href={`/pitches/${id}/edit`}>Edit details</Link>}
          {can(actor, "pitch.archive") && !d.archived && <ActionForm endpoint={`/api/v1/pitches/${id}/archive`} fields={[]} extra={{ archived: true }} submitLabel="Archive" title="Archive" collapsed danger confirm="Archive this pitch? It can be restored later." />}
          {can(actor, "pitch.restore") && d.archived && <ActionForm endpoint={`/api/v1/pitches/${id}/archive`} fields={[]} extra={{ archived: false }} submitLabel="Restore" />}
        </div>
      </div>

      {d.archived && <p className="notice">This pitch is archived. Its full history is preserved.</p>}

      {s.readyToGo && s.approvedPlatform && (
        <div className="ready-banner" role="status">
          <strong>👍 READY TO GO</strong> — {s.approvedPlatform.name}
          <ul><li>✓ Script approved</li><li>✓ Platform approved</li><li>✓ Ready for development</li></ul>
        </div>
      )}

      <section className="status-hero" aria-label="Where is this story now?">
        <div className="headline">
          <span className="big">Where is this story now?</span>
          <StageBadge badge={s.badge} label={s.stageKey === "READY_FOR_DEVELOPMENT" ? "READY FOR DEVELOPMENT" : s.stageName} />
        </div>
        <div className="status-grid">
          <div><div className="label">Current status</div><div className="val">{s.stageName}</div></div>
          <div><div className="label">Current level</div><div className="val">{s.currentLevel}</div></div>
          <div><div className="label">Current owner</div><div className="val">{s.ownerName ?? "Nobody (closed)"}</div></div>
          <div><div className="label">Next action</div><div className="val">{s.nextAction}</div></div>
          <div><div className="label">Waiting since</div><div className="val">{fmtDate(s.stageSince)}</div></div>
          <div><div className="label">Days in current stage</div><div className={`val aging-${s.aging}`}>{s.daysInStage} days{s.aging !== "ok" ? ` · ${s.aging}` : ""}</div></div>
          <div><div className="label">Rejected?</div><div className="val">{s.wasRejected ? `Yes — ${labelOf(lookups, "REJECTION_CATEGORY", s.rejection?.categoryKey)}` : "No"}</div></div>
          <div><div className="label">CEO / COO approved?</div><div className="val">{s.executiveDecision ? `Yes — ${s.executiveDecision.by ?? s.executiveDecision.approvalType}, ${fmtDate(s.executiveDecision.at)}` : "No"}</div></div>
          <div><div className="label">Platform</div><div className="val">{s.latestPlatform ? `${s.latestPlatform.name} · ${PLATFORM_STATUS_LABEL[s.latestPlatform.status] ?? s.latestPlatform.status}` : "Not pitched"}</div></div>
          <div><div className="label">Rating</div><div className="val"><Stars value={s.rating} /> <span className="muted">({s.ratingCount})</span></div></div>
        </div>
        {s.rejection && <p className="subtle">Rejection reason: {s.rejection.reason}</p>}
      </section>

      <Tabs base={`/pitches/${id}`} current={tab} tabs={TABS} />

      {tab === "overview" && <Overview d={d} lookups={lookups} />}
      {tab === "documents" && <DocumentsTab actor={actor} pitchId={id} lookups={lookups} archived={d.archived} fresh={sp.new === "1"} />}
      {tab === "workflow" && <WorkflowTab actor={actor} pitchId={id} version={p.version} lookups={lookups} suggest={sp.suggest} to={sp.to} />}
      {tab === "remarks" && <RemarksTab actor={actor} pitchId={id} lookups={lookups} />}
      {tab === "platforms" && <PlatformsTab actor={actor} pitchId={id} version={p.version} stageKey={s.stageKey} ownerId={s.ownerId} lookups={lookups} />}
      {tab === "creator" && <CreatorTab actor={actor} creatorId={creator.id} />}
      {tab === "projects" && <ProjectsTab actor={actor} creatorId={creator.id} />}
      {tab === "ratings" && <RatingsTab actor={actor} pitchId={id} />}
      {tab === "images" && <ImagesTab actor={actor} pitchId={id} lookups={lookups} archived={d.archived} />}
      {tab === "development" && <DevelopmentTab actor={actor} pitchId={id} version={p.version} stageKey={s.stageKey} />}
      {tab === "production" && <ProductionTab actor={actor} pitchId={id} version={p.version} stageKey={s.stageKey} />}
      {tab === "activity" && <ActivityTab actor={actor} pitchId={id} />}
    </>
  );
}

type Detail = Awaited<ReturnType<typeof getPitchDetail>>;

function Overview({ d, lookups }: { d: Detail; lookups: LookupMap }) {
  const p = d.pitch;
  return (
    <div className="grid-2">
      <div className="section">
        <h2>What is this?</h2>
        {p.logline && <p><strong>{p.logline}</strong></p>}
        {p.shortSynopsis && <p>{p.shortSynopsis}</p>}
        {p.detailedSynopsis && <details><summary>Detailed synopsis</summary><p className="quote">{p.detailedSynopsis}</p></details>}
        {!p.logline && !p.shortSynopsis && <p className="muted">No synopsis yet.</p>}
      </div>
      <dl className="kv section">
        <dt>Format</dt><dd>{labelOf(lookups, "FORMAT", p.formatKey)}</dd>
        <dt>Language</dt><dd>{labelOf(lookups, "LANGUAGE", p.languageKey)}</dd>
        <dt>Genre</dt><dd>{labelOf(lookups, "GENRE", p.genreKey)}{p.subGenreKey ? ` · ${labelOf(lookups, "SUB_GENRE", p.subGenreKey)}` : ""}</dd>
        <dt>Episodes</dt><dd>{p.episodeCount ?? "—"}{p.episodeDurationMin ? ` × ${p.episodeDurationMin} min` : ""}</dd>
        <dt>Budget range</dt><dd>{labelOf(lookups, "BUDGET_RANGE", p.budgetRangeKey)}</dd>
        <dt>Target audience</dt><dd>{p.targetAudience ?? "—"}</dd>
        <dt>Tags</dt><dd>{p.tags.length ? <span className="chips">{p.tags.map((t) => <span key={t} className="chip">{t}</span>)}</span> : "—"}</dd>
        <dt>Submitted</dt><dd>{fmtDateTime(p.createdAt)}</dd>
        <dt>Last updated</dt><dd>{fmtDateTime(p.updatedAt)}</dd>
        <dt>Reviewed by</dt><dd>{d.status.reviewers.join(", ") || "—"}</dd>
        {p.notes && <><dt>Notes</dt><dd>{p.notes}</dd></>}
      </dl>
    </div>
  );
}

async function DocumentsTab({ actor, pitchId, lookups, archived, fresh }: { actor: Actor; pitchId: string; lookups: LookupMap; archived: boolean; fresh: boolean }) {
  const db = getDb(actor);
  const docs = await pageData(() => listPitchDocuments(db, actor, pitchId));
  if (!docs) return <p className="notice">You do not have access to documents.</p>;
  const cats = (lookups.DOCUMENT_CATEGORY ?? []).filter((c) => c.active);
  const canUpload = can(actor, "document.upload") && !archived;
  const downloads = can(actor, "pitch.view_all") ? await pitchDownloadLog(db, actor, pitchId) : null;
  return (
    <>
      {fresh && <p className="success">Pitch submitted. Upload the script and any supporting documents below.</p>}
      {canUpload && <UploadPanel kind="DOCUMENT" pitchId={pitchId} categories={cats} title="+ Upload new document" />}
      <p className="subtle">Files are stored privately. Downloads use links that expire in about a minute, and every download is recorded. Files are content-checked on upload; no antivirus scan is configured yet, so they show “Not virus-scanned”.</p>
      {docs.length === 0 ? <Empty>No documents yet.</Empty> : docs.map((doc) => (
        <div key={doc.id} className="section">
          <h2>{doc.title} <span className="chip">{labelOf(lookups, "DOCUMENT_CATEGORY", doc.categoryKey)}</span></h2>
          <div className="table-wrap"><table className="data">
            <thead><tr><th>Version</th><th>File</th><th>Uploaded</th><th>By</th><th>Notes</th><th>Security</th><th></th></tr></thead>
            <tbody>{doc.versions.map((v) => (
              <tr key={v.id}>
                <td><strong>V{v.versionNo}</strong>{v.isCurrent && <span className="badge b-approved">Current</span>}{v.versionLabel && <div className="muted">{v.versionLabel}</div>}</td>
                <td>{v.originalFilename}<div className="muted">{(v.sizeBytes / 1024).toFixed(0)} KB · sha256 {v.sha256.slice(0, 12)}…</div></td>
                <td>{fmtDateTime(v.createdAt)}</td><td>{v.uploadedByName}</td><td>{v.notes ?? ""}</td>
                <td>{v.scanStatus === "CLEAN" ? "Scanned clean" : v.scanStatus === "NOT_SCANNED" ? "Not virus-scanned" : v.scanStatus}</td>
                <td style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                  {can(actor, "document.download") && <ViewInPopupButton href={`/api/v1/document-versions/${v.id}/view`} />}
                  {can(actor, "document.download") && <a className="btn-secondary" href={`/api/v1/document-versions/${v.id}/download`} rel="noreferrer">Download</a>}
                  {canUpload && !v.isCurrent && <ActionForm endpoint={`/api/v1/documents/${doc.id}/current`} fields={[]} extra={{ versionId: v.id }} submitLabel="Make current" />}
                </td>
              </tr>
            ))}</tbody>
          </table></div>
          {canUpload && <UploadPanel kind="DOCUMENT" pitchId={pitchId} documentId={doc.id} categories={cats.filter((c) => c.key === doc.categoryKey)} title={`+ Upload V${(doc.versions[0]?.versionNo ?? 0) + 1}`} />}
        </div>
      ))}
      {downloads && (
        <div className="section"><h2>Who downloaded these files?</h2>
          {downloads.length === 0 ? <p className="muted">No downloads yet.</p> : (
            <table className="data"><thead><tr><th>Who</th><th>File</th><th>When</th></tr></thead>
              <tbody>{downloads.map((x, i) => <tr key={i}><td>{x.userName}</td><td>{x.title} V{x.versionNo}</td><td>{fmtDateTime(x.at)}</td></tr>)}</tbody></table>
          )}
        </div>
      )}
    </>
  );
}

/** Builds form fields for a generic workflow action from the transition's configured requirements. */
function actionFields(a: Awaited<ReturnType<typeof getAvailableActions>>[number], lookups: LookupMap, platforms: { id: string; name: string }[], ratingCats: { key: string; label: string }[], canRate: boolean): FieldSpec[] {
  const f: FieldSpec[] = [];
  if (a.requires.recipient) f.push({ name: "recipientId", label: "Send to", type: "user", required: true, ...(a.requires.recipientRoles ? { roles: a.requires.recipientRoles } : {}) });
  if (a.requires.rejectionReason) {
    f.push({ name: "rejectionCategoryKey", label: "Rejection category", type: "select", required: true, options: (lookups.REJECTION_CATEGORY ?? []).filter((l) => l.active).map((l) => ({ value: l.key, label: l.label })) });
    f.push({ name: "rejectionReason", label: "Detailed reason", type: "textarea", required: true, hint: "Required. At least 10 characters. This is kept permanently." });
  }
  if (a.requires.changeTypes) f.push({ name: "changeTypeKeys", label: "Changes needed", type: "checkboxes", required: true, options: (lookups.CHANGE_REQUEST_TYPE ?? []).map((l) => ({ value: l.key, label: l.label })) });
  if (a.requires.platform) f.push({ name: "platformId", label: "Platform", type: "select", required: true, options: platforms.map((p) => ({ value: p.id, label: p.name })) });
  if (a.action === "SEND_TO_PLATFORM" || a.action === "APPROVE") f.push({ name: "recommendedPlatformIds", label: "Recommended platforms", type: "checkboxes", options: platforms.map((p) => ({ value: p.id, label: p.name })) });
  f.push({ name: "remarks", label: "Remarks", type: "textarea", required: a.requires.remarks });
  if (a.action === "ACCEPT" || a.action === "FORWARD") f.push({ name: "recommendation", label: "Recommendation", type: "text", maxLength: 2000 });
  if (canRate && ["ACCEPT", "FORWARD", "REJECT", "REQUEST_CHANGES", "SEND_TO_PLATFORM", "APPROVE"].includes(a.action)) {
    f.push({ name: "rating.overall", label: "Your overall rating (optional)", type: "stars", hint: ratingCats.length ? "Category scores can be added from the Ratings tab." : undefined });
  }
  return f;
}

async function WorkflowTab({ actor, pitchId, version, lookups, suggest, to }: { actor: Actor; pitchId: string; version: number; lookups: LookupMap; suggest?: string; to?: string }) {
  const db = getDb(actor);
  const [actions, events, platforms, ratingCats, stages] = await Promise.all([getAvailableActions(db, actor, pitchId), getTimeline(db, actor, pitchId),
    getPlatformOptions(db), getRatingCategories(db), getActiveStages(db)]);
  const generic = actions.filter((a) => !TRACKER_ACTIONS.has(a.action));
  const tracker = actions.filter((a) => TRACKER_ACTIONS.has(a.action));
  const stageName = (k: string | null) => stages.find((x) => x.key === k)?.name ?? k ?? "previous stage";
  const ordered = suggest ? [...generic].sort((a, b) => Number(b.action === suggest && b.toStageKey === to) - Number(a.action === suggest && a.toStageKey === to)) : generic;
  return (
    <div className="grid-2">
      <div>
        <h2>Actions available to you</h2>
        {actions.length === 0 && <p className="muted">No actions for you at this stage. The current owner or management acts next.</p>}
        {ordered.map((a, i) => (
          <ActionForm key={`${a.action}-${a.toStageKey}`} endpoint={`/api/v1/pitches/${pitchId}/actions`}
            title={`${ACTION_LABEL[a.action] ?? a.action}${a.toStageKey ? ` → ${stageName(a.toStageKey)}` : ""}`}
            submitLabel={ACTION_LABEL[a.action] ?? a.action} danger={a.action === "REJECT"} collapsed={!(suggest === a.action && to === a.toStageKey) || i > 0}
            extra={{ action: a.action, expectedVersion: version, ...(a.toStageKey ? { toStageKey: a.toStageKey } : {}) }}
            fields={actionFields(a, lookups, platforms, ratingCats, can(actor, "rating.add"))} />
        ))}
        {tracker.length > 0 && (
          <p className="subtle">Also available: {tracker.map((a) => ACTION_LABEL[a.action]).join(", ")} — use the {tracker.some((a) => a.action.includes("PLATFORM")) ? <Link href={`/pitches/${pitchId}?tab=platforms`}>Platform Pitches</Link> : null}
            {tracker.some((a) => a.action === "START_DEVELOPMENT" || a.action === "GREENLIGHT") ? <> <Link href={`/pitches/${pitchId}?tab=development`}>Development</Link></> : null}
            {tracker.some((a) => a.action === "ADVANCE") ? <> <Link href={`/pitches/${pitchId}?tab=production`}>Production</Link></> : null} tab.</p>
        )}
      </div>
      <div>
        <h2>Timeline</h2>
        <Timeline actor={actor} events={events} lookups={lookups} stageName={stageName} />
      </div>
    </div>
  );
}

async function Timeline({ actor, events, lookups, stageName }: { actor: Actor; events: Awaited<ReturnType<typeof getTimeline>>; lookups: LookupMap; stageName: (k: string | null) => string }) {
  const db = getDb(actor);
  const names = await userNames(db, events.flatMap((e) => [e.actorId, e.toOwnerId, e.fromOwnerId]));
  const platforms = await getPlatformOptions(db, true);
  const cls = (a: string) => (a === "REJECT" ? "t-reject" : ["SEND_TO_PLATFORM", "APPROVE", "GREENLIGHT", "MARK_PLATFORM_APPROVED", "MARK_READY_FOR_DEVELOPMENT"].includes(a) ? "t-approve" : a.includes("PLATFORM") ? "t-platform" : "");
  return (
    <ol className="timeline">
      {events.map((e) => (
        <li key={e.id} className={cls(e.action)}>
          <div className="when">{fmtDateTime(e.createdAt)}</div>
          <div className="what">{ACTION_LABEL[e.action] ?? e.action}{(e.metadata as { partialApproval?: boolean })?.partialApproval ? " (awaiting second executive)" : ""}
            {e.action === "MARK_READY_FOR_DEVELOPMENT" ? " 👍" : ""}</div>
          <div>{names.get(e.actorId) ?? "—"}{e.approvalType ? ` (${e.approvalType})` : ""}
            {e.toOwnerId && e.fromOwnerId && e.toOwnerId !== e.fromOwnerId ? ` → ${names.get(e.toOwnerId) ?? ""}` : ""}
            {e.fromStageKey && e.fromStageKey !== e.toStageKey ? ` · ${stageName(e.fromStageKey)} → ${stageName(e.toStageKey)}` : ""}
            {e.platformId ? ` · ${platforms.find((p) => p.id === e.platformId)?.name ?? ""}` : ""}</div>
          {e.rejectionCategoryKey && <div className="quote"><strong>{labelOf(lookups, "REJECTION_CATEGORY", e.rejectionCategoryKey)}:</strong> {e.rejectionReason}</div>}
          {e.changeTypeKeys?.length ? <div className="muted">Changes: {e.changeTypeKeys.map((k) => labelOf(lookups, "CHANGE_REQUEST_TYPE", k)).join(", ")}</div> : null}
          {e.remarks && <div className="quote">{e.remarks}</div>}
          {e.recommendation && <div className="quote">Recommendation: {e.recommendation}</div>}
        </li>
      ))}
    </ol>
  );
}

async function RemarksTab({ actor, pitchId, lookups }: { actor: Actor; pitchId: string; lookups: LookupMap }) {
  const db = getDb(actor);
  const events = (await getTimeline(db, actor, pitchId)).filter((e) => e.remarks || e.recommendation || e.rejectionReason);
  const names = await userNames(db, events.map((e) => e.actorId));
  if (!events.length) return <Empty>No remarks yet.</Empty>;
  return (
    <div className="table-wrap"><table className="data">
      <thead><tr><th>When</th><th>Who</th><th>Decision</th><th>What they said</th></tr></thead>
      <tbody>{events.map((e) => (
        <tr key={e.id}><td>{fmtDateTime(e.createdAt)}</td><td>{names.get(e.actorId)}</td><td>{ACTION_LABEL[e.action] ?? e.action}</td>
          <td>{e.rejectionReason && <p><strong>{labelOf(lookups, "REJECTION_CATEGORY", e.rejectionCategoryKey)}:</strong> {e.rejectionReason}</p>}{e.remarks && <p>{e.remarks}</p>}{e.recommendation && <p className="muted">Recommendation: {e.recommendation}</p>}</td></tr>
      ))}</tbody>
    </table></div>
  );
}

async function PlatformsTab({ actor, pitchId, version, stageKey, ownerId, lookups }: { actor: Actor; pitchId: string; version: number; stageKey: string; ownerId: string | null; lookups: LookupMap }) {
  const db = getDb(actor);
  const list = await pageData(() => pitchPlatformPitches(db, actor, pitchId));
  if (!list) return <p className="notice">You do not have access to platform information.</p>;
  const platforms = await getPlatformOptions(db);
  const docs = can(actor, "document.view_meta") ? await listPitchDocuments(db, actor, pitchId) : [];
  const versionOpts = docs.flatMap((d) => d.versions.map((v) => ({ value: v.id, label: `${d.title} V${v.versionNo}${v.isCurrent ? " (current)" : ""}`, category: d.categoryKey })));
  const canPitch = can(actor, "platform.pitch") && ["APPROVED_FOR_PLATFORM", "PLATFORM_PITCHING"].includes(stageKey) && ownerId === actor.userId;
  const statusOpts = Object.entries(PLATFORM_STATUS_LABEL).filter(([k]) => k !== "NOT_YET_PITCHED").map(([value, label]) => ({ value, label }));
  const today = new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
  return (
    <>
      {!["APPROVED_FOR_PLATFORM", "PLATFORM_PITCHING", "PLATFORM_APPROVED", "READY_FOR_DEVELOPMENT", "DEVELOPMENT", "GREENLIT", "PRE_PRODUCTION", "PRODUCTION", "POST_PRODUCTION", "COMPLETED", "RELEASED"].includes(stageKey) &&
        <p className="notice">A pitch can be sent to platforms only after CEO / COO approval.</p>}
      {canPitch && (
        <ActionForm endpoint={`/api/v1/pitches/${pitchId}/platform-pitches`} title="+ Record a platform pitch" submitLabel="Record pitch" collapsed extra={{ expectedVersion: version }}
          fields={[
            { name: "platformId", label: "Platform", type: "select", required: true, options: platforms.map((p) => ({ value: p.id, label: p.name })) },
            { name: "pitchDate", label: "Pitch date", type: "date", required: true, defaultValue: today },
            { name: "methodKey", label: "Pitch method", type: "select", options: (lookups.PITCH_METHOD ?? []).map((l) => ({ value: l.key, label: l.label })) },
            { name: "materialsSent", label: "Material sent", type: "checkboxes", options: ["Pitch deck", "Script", "Synopsis", "One-line", "Character document", "Director's note", "Presentation", "Trailer / mood reel"].map((m) => ({ value: m, label: m })) },
            { name: "scriptVersionId", label: "Script version sent", type: "select", options: versionOpts },
            { name: "deckVersionId", label: "Pitch deck version sent", type: "select", options: versionOpts },
            { name: "followUpOn", label: "Follow-up date", type: "date" },
            { name: "remarks", label: "Remarks", type: "textarea" },
          ]} />
      )}
      {list.length === 0 ? <Empty>Not pitched to any platform yet.</Empty> : list.map((pp) => (
        <div key={pp.id} className="section">
          <h2>{pp.platformName} {pp.roundNo > 1 ? `· round ${pp.roundNo}` : ""} <span className="chip">{PLATFORM_STATUS_LABEL[pp.currentStatus]}</span></h2>
          <dl className="kv">
            <dt>Pitched by</dt><dd>{pp.pitchedBy}</dd><dt>Pitch date</dt><dd>{fmtDate(pp.pitchDate)}</dd>
            <dt>Contact</dt><dd>{pp.contactName ? `${pp.contactName}${pp.contactDesignation ? `, ${pp.contactDesignation}` : ""}` : "—"}</dd>
            <dt>Method</dt><dd>{labelOf(lookups, "PITCH_METHOD", pp.methodKey)}</dd>
            <dt>Material sent</dt><dd>{(pp.materialsSent as string[]).join(", ") || "—"}</dd>
            <dt>Script version</dt><dd>{versionOpts.find((v) => v.value === pp.scriptVersionId)?.label ?? "—"}</dd>
            <dt>Next follow-up</dt><dd>{fmtDate(pp.nextFollowUpOn)}</dd>
            {pp.remarks && <><dt>Remarks</dt><dd>{pp.remarks}</dd></>}
          </dl>
          <h3>Response history</h3>
          <ol className="timeline">{pp.responses.map((r) => (
            <li key={r.id} className={r.status === "REJECTED" ? "t-reject" : r.status === "APPROVED" ? "t-approve" : "t-platform"}>
              <div className="when">{fmtDate(r.responseDate)} · recorded by {r.recordedBy}</div>
              <div className="what">{pp.platformName}: {PLATFORM_STATUS_LABEL[r.status]}</div>
              {r.notes && <div className="quote">{r.notes}</div>}
            </li>
          ))}</ol>
          {pp.followUps.length > 0 && (
            <table className="data"><thead><tr><th>Follow-up due</th><th>Assignee</th><th>Status</th><th></th></tr></thead>
              <tbody>{pp.followUps.map((f) => (
                <tr key={f.id}><td>{fmtDate(f.dueOn)}</td><td>{f.assignee}</td><td>{f.completedAt ? `Done — ${f.outcome}` : "Open"}</td>
                  <td>{!f.completedAt && <ActionForm endpoint={`/api/v1/follow-ups/${f.id}/complete`} title="Complete" submitLabel="Mark done" collapsed fields={[{ name: "outcome", label: "Outcome", type: "text", required: true }]} />}</td></tr>
              ))}</tbody></table>
          )}
          {can(actor, "platform.record_response") && (
            <ActionForm endpoint={`/api/v1/platform-pitches/${pp.id}/responses`} title="+ Record platform response" submitLabel="Save response" collapsed extra={{ expectedVersion: version }}
              description="Responses are added to the history; earlier responses are never overwritten. Approved moves the pitch to Platform Approved."
              fields={[
                { name: "status", label: "Response", type: "select", required: true, options: statusOpts },
                { name: "responseDate", label: "Response date", type: "date", required: true, defaultValue: today },
                { name: "notes", label: "What the platform said", type: "textarea" },
                { name: "nextFollowUpOn", label: "Next follow-up", type: "date" },
              ]} />
          )}
        </div>
      ))}
    </>
  );
}

async function CreatorTab({ actor, creatorId }: { actor: Actor; creatorId: string }) {
  const profile = await pageData(() => getCreatorProfile(getDb(actor), actor, creatorId));
  if (!profile) return <p className="notice">You do not have access to creator profiles.</p>;
  const c = profile.creator;
  return (
    <div className="section">
      <h2><Link href={`/creators/${c.id}`}>{c.fullName}</Link> · {typeLabel(c.creatorType)}</h2>
      <dl className="kv">
        <dt>Mobile</dt><dd>{c.mobile ?? "—"}</dd><dt>Email</dt><dd>{c.email ?? "—"}</dd><dt>Location</dt><dd>{c.location ?? "—"}</dd>
        <dt>Experience</dt><dd>{c.yearsExperience ?? "—"} years</dd><dt>Total pitches</dt><dd>{profile.stats.total}</dd>
        <dt>CEO/COO approved</dt><dd>{profile.stats.approved}</dd><dt>Platform approved</dt><dd>{profile.stats.platformApproved}</dd>
      </dl>
      {c.bio && <p>{c.bio}</p>}
    </div>
  );
}

async function ProjectsTab({ actor, creatorId }: { actor: Actor; creatorId: string }) {
  const profile = await pageData(() => getCreatorProfile(getDb(actor), actor, creatorId));
  if (!profile) return <p className="notice">You do not have access to creator profiles.</p>;
  if (!profile.projects.length) return <Empty>No previous projects recorded for this creator.</Empty>;
  return (
    <div className="table-wrap"><table className="data">
      <thead><tr><th>Project</th><th>Role</th><th>Company</th><th>Platform</th><th>Year</th></tr></thead>
      <tbody>{profile.projects.map((p) => <tr key={p.id}><td>{p.projectName}</td><td>{typeLabel(p.role)}</td><td>{p.productionCompany ?? "—"}</td><td>{p.platformName ?? "—"}</td><td>{p.releaseYear ?? "—"}</td></tr>)}</tbody>
    </table></div>
  );
}

async function RatingsTab({ actor, pitchId }: { actor: Actor; pitchId: string }) {
  const db = getDb(actor);
  const cats = await getRatingCategories(db);
  const visible = await canSeeRatings(db, actor);
  const { ratings: ratingsTable, ratingScores, users, ratingCategories } = await import("@/server/db/schema");
  const { eq, desc, inArray } = await import("drizzle-orm");
  const rows = visible ? await db.select({ id: ratingsTable.id, overall: ratingsTable.overall, comments: ratingsTable.comments, at: ratingsTable.createdAt, by: users.fullName })
    .from(ratingsTable).innerJoin(users, eq(users.id, ratingsTable.reviewerId)).where(eq(ratingsTable.pitchId, pitchId)).orderBy(desc(ratingsTable.createdAt)) : [];
  const scores = rows.length ? await db.select({ ratingId: ratingScores.ratingId, label: ratingCategories.label, score: ratingScores.score })
    .from(ratingScores).innerJoin(ratingCategories, eq(ratingCategories.id, ratingScores.categoryId)).where(inArray(ratingScores.ratingId, rows.map((r) => r.id))) : [];
  return (
    <>
      {can(actor, "rating.add") && (
        <ActionForm endpoint={`/api/v1/pitches/${pitchId}/ratings`} title="+ Rate this creator's work" submitLabel="Save rating" collapsed
          description="Each rating is kept as a separate record with your name and the date."
          fields={[{ name: "overall", label: "Overall", type: "stars", required: true }, { name: "comments", label: "Comments", type: "textarea" }]} />
      )}
      {can(actor, "rating.add") && cats.length > 0 && (
        <RatingCategoryForm pitchId={pitchId} cats={cats.map((c) => ({ key: c.key, label: c.label }))} />
      )}
      {!visible ? <p className="notice">Rating history is visible to management only.</p> : rows.length === 0 ? <Empty>No ratings yet.</Empty> : (
        <div className="table-wrap"><table className="data">
          <thead><tr><th>Date</th><th>Reviewer</th><th>Overall</th><th>Categories</th><th>Comments</th></tr></thead>
          <tbody>{rows.map((r) => <tr key={r.id}><td>{fmtDate(r.at)}</td><td>{r.by}</td><td><Stars value={r.overall} /></td>
            <td>{scores.filter((s) => s.ratingId === r.id).map((s) => `${s.label} ${s.score}`).join(" · ") || "—"}</td><td>{r.comments ?? ""}</td></tr>)}</tbody>
        </table></div>
      )}
    </>
  );
}

async function ImagesTab({ actor, pitchId, lookups, archived }: { actor: Actor; pitchId: string; lookups: LookupMap; archived: boolean }) {
  const images = await pageData(() => listPitchImages(getDb(actor), getStorage(), actor, pitchId));
  if (!images) return <p className="notice">You do not have access to images.</p>;
  return (
    <>
      {can(actor, "document.upload") && !archived && <UploadPanel kind="IMAGE" pitchId={pitchId} categories={(lookups.IMAGE_CATEGORY ?? []).filter((l) => l.active)} title="+ Add image" />}
      {images.length === 0 ? <Empty>No images yet.</Empty> : (
        <div className="pitch-cards">{images.map((img) => (
          <figure key={img.id} className="pitch-card">
            {/* eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL from private storage */}
            <img src={img.url} alt={img.caption ?? labelOf(lookups, "IMAGE_CATEGORY", img.categoryKey)} loading="lazy" referrerPolicy="no-referrer" />
            <figcaption><strong>{labelOf(lookups, "IMAGE_CATEGORY", img.categoryKey)}</strong>{img.caption ? ` — ${img.caption}` : ""}<div className="muted">{fmtDate(img.createdAt)}</div></figcaption>
          </figure>
        ))}</div>
      )}
    </>
  );
}

async function DevelopmentTab({ actor, pitchId, version, stageKey }: { actor: Actor; pitchId: string; version: number; stageKey: string }) {
  const db = getDb(actor);
  const dp = await pageData(() => pitchDevelopmentAndProduction(db, actor, pitchId));
  if (!dp) return <p className="notice">No access.</p>;
  const dev = dp.development;
  return (
    <>
      {stageKey === "PLATFORM_APPROVED" && <p className="notice">Platform approved. Confirm “Ready for development” from the Workflow tab.</p>}
      {stageKey === "READY_FOR_DEVELOPMENT" && can(actor, "development.manage") && (
        <ActionForm endpoint={`/api/v1/pitches/${pitchId}/development`} title="Start development" submitLabel="Start development" extra={{ expectedVersion: version }}
          fields={[{ name: "ownerId", label: "Development owner", type: "user", required: true }, { name: "startDate", label: "Start date", type: "date" },
            { name: "expectedCompletion", label: "Expected completion", type: "date" }, { name: "requirements", label: "Requirements", type: "textarea" }, { name: "notes", label: "Notes", type: "textarea" }]} />
      )}
      {stageKey === "DEVELOPMENT" && can(actor, "pitch.approve_executive") && (
        <ActionForm endpoint={`/api/v1/pitches/${pitchId}/greenlight`} title="🎬 Greenlight" submitLabel="Greenlight" collapsed extra={{ expectedVersion: version }}
          fields={[{ name: "productionOwnerId", label: "Production owner", type: "user", required: true }, { name: "remarks", label: "Decision remarks", type: "textarea", required: true },
            { name: "productionCompany", label: "Production company", type: "text" }, { name: "startDate", label: "Production start", type: "date" },
            { name: "expectedRelease", label: "Expected release", type: "date" }, { name: "budgetRupees", label: "Budget (₹)", type: "number", min: 0 }]} />
      )}
      {!dev ? <Empty>Development has not started.</Empty> : (
        <div className="section">
          <h2>Development — {dev.status.replaceAll("_", " ").toLowerCase()}</h2>
          <dl className="kv"><dt>Owner</dt><dd>{dev.ownerName}</dd><dt>Start</dt><dd>{fmtDate(dev.startDate)}</dd><dt>Expected completion</dt><dd>{fmtDate(dev.expectedCompletion)}</dd>
            {dev.requirements && <><dt>Requirements</dt><dd>{dev.requirements}</dd></>}</dl>
          {can(actor, "development.manage") && stageKey === "DEVELOPMENT" && (
            <ActionForm endpoint={`/api/v1/development/${dev.id}/updates`} title="+ Add development update" submitLabel="Add update" collapsed
              fields={[{ name: "kind", label: "Type", type: "select", required: true, options: [["NOTE", "Note"], ["MEETING", "Meeting"], ["PLATFORM_FEEDBACK", "Platform feedback"], ["REQUIREMENT", "Requirement"], ["STATUS", "Status change"]].map(([value, label]) => ({ value: value!, label: label! })) },
                { name: "status", label: "Status", type: "select", options: ["DEVELOPMENT_STARTED", "SCRIPT_DEVELOPMENT", "CASTING_DEVELOPMENT", "PACKAGING", "AWAITING_APPROVAL", "DEVELOPMENT_COMPLETED"].map((v) => ({ value: v, label: v.replaceAll("_", " ").toLowerCase() })) },
                { name: "body", label: "Details", type: "textarea", required: true }, { name: "expectedCompletion", label: "New expected completion", type: "date" }]} />
          )}
          <ol className="timeline">{dev.updates.map((u) => <li key={u.id}><div className="when">{fmtDateTime(u.createdAt)} · {u.author}</div><div className="what">{u.kind.replaceAll("_", " ").toLowerCase()} · {u.status.replaceAll("_", " ").toLowerCase()}</div>{u.body && <div className="quote">{u.body}</div>}</li>)}</ol>
        </div>
      )}
    </>
  );
}

async function ProductionTab({ actor, pitchId, version, stageKey }: { actor: Actor; pitchId: string; version: number; stageKey: string }) {
  const dp = await pageData(() => pitchDevelopmentAndProduction(getDb(actor), actor, pitchId));
  const prod = dp?.production;
  if (!prod) return <Empty>Not greenlit yet.</Empty>;
  const next: Record<string, string> = { GREENLIT: "Pre-Production", PRE_PRODUCTION: "Production", PRODUCTION: "Post-Production", POST_PRODUCTION: "Completed", COMPLETED: "Released" };
  return (
    <div className="section">
      <h2>🎬 Production — {prod.status.replaceAll("_", " ").toLowerCase()}</h2>
      <dl className="kv"><dt>Owner</dt><dd>{prod.ownerName}</dd><dt>Company</dt><dd>{prod.productionCompany ?? "—"}</dd><dt>Platform</dt><dd>{prod.platformName ?? "—"}</dd>
        <dt>Start</dt><dd>{fmtDate(prod.startDate)}</dd><dt>Expected release</dt><dd>{fmtDate(prod.expectedRelease)}</dd><dt>Actual release</dt><dd>{fmtDate(prod.actualRelease)}</dd>
        <dt>Budget</dt><dd>{prod.budgetRupees !== null ? `₹${prod.budgetRupees.toLocaleString("en-IN")}` : can(actor, "pitch.view_all") ? "—" : "Management only"}</dd></dl>
      {can(actor, "production.manage") && next[stageKey] && (
        <ActionForm endpoint={`/api/v1/pitches/${pitchId}/production/advance`} title={`Move to ${next[stageKey]}`} submitLabel={`Move to ${next[stageKey]}`} collapsed extra={{ expectedVersion: version }}
          fields={[{ name: "remarks", label: "Remarks", type: "textarea" }, ...(stageKey === "COMPLETED" ? [{ name: "actualRelease", label: "Actual release date", type: "date" as const, required: true }] : [])]} />
      )}
      {can(actor, "production.manage") && (
        <ActionForm endpoint={`/api/v1/production/${prod.id}`} method="PATCH" title="+ Update production details" submitLabel="Save" collapsed
          fields={[{ name: "note", label: "Production note", type: "textarea", required: true }, { name: "productionCompany", label: "Production company", type: "text" },
            { name: "startDate", label: "Start", type: "date" }, { name: "expectedRelease", label: "Expected release", type: "date" },
            ...(can(actor, "pitch.view_all") ? [{ name: "budgetRupees", label: "Budget (₹)", type: "number" as const, min: 0 }] : [])]} />
      )}
      <ol className="timeline">{prod.updates.map((u) => <li key={u.id}><div className="when">{fmtDateTime(u.createdAt)} · {u.author}</div><div className="what">{u.status.replaceAll("_", " ").toLowerCase()}</div>{u.body && <div className="quote">{u.body}</div>}</li>)}</ol>
    </div>
  );
}

async function ActivityTab({ actor, pitchId }: { actor: Actor; pitchId: string }) {
  const db = getDb(actor);
  if (can(actor, "audit.view")) {
    const { queryAudit } = await import("@/server/modules/admin/config");
    const page = await queryAudit(db, actor, { resourceType: "pitch", resourceId: pitchId, limit: 200 });
    return (
      <div className="table-wrap"><table className="data"><thead><tr><th>When</th><th>Who</th><th>Action</th><th>IP</th></tr></thead>
        <tbody>{page.items.map((a) => <tr key={a.id}><td>{fmtDateTime(a.createdAt)}</td><td>{a.actorName ?? "System"}</td><td>{a.action}</td><td>{a.ip ?? ""}</td></tr>)}</tbody></table></div>
    );
  }
  const events = await getTimeline(db, actor, pitchId);
  const names = await userNames(db, events.map((e) => e.actorId));
  return (
    <div className="table-wrap"><table className="data"><thead><tr><th>When</th><th>Who</th><th>What</th></tr></thead>
      <tbody>{[...events].reverse().map((e) => <tr key={e.id}><td>{fmtDateTime(e.createdAt)}</td><td>{names.get(e.actorId)}</td><td>{ACTION_LABEL[e.action] ?? e.action}</td></tr>)}</tbody></table></div>
  );
}

