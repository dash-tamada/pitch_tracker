import Link from "next/link";
import { getDb } from "@/server/db/client";
import { AppError } from "@/server/lib/errors";
import { requirePageSession } from "@/server/lib/page-session";
import { can } from "@/server/modules/authz/policy";
import { filterToSearchParams, listSavedFilters } from "@/server/modules/filters/service";
import { getActiveStages, getLookups, getPlatformOptions, labelOf } from "@/server/modules/lookups/service";
import { listPitches } from "@/server/modules/pitches/service";
import { KanbanBoard } from "@/components/kanban";
import { PLATFORM_STATUS_LABEL, typeLabel } from "@/components/labels";
import { DeleteFilter, SaveFilter } from "@/components/saved-filters";
import { Empty, fmtDate, PageHeader, StageBadge, Stars } from "@/components/ui";

const FILTER_KEYS = ["q", "stage", "genre", "language", "format", "priority", "creatorType", "ownerId", "mine", "platformId", "platformStatus", "createdFrom", "createdTo", "minDaysWaiting", "minRating", "archived", "sort"] as const;

export default async function PitchesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { actor } = await requirePageSession();
  const sp = await searchParams;
  const view = sp.view === "cards" || sp.view === "kanban" ? sp.view : "table";
  const one = (k: string) => (Array.isArray(sp[k]) ? (sp[k] as string[]).join(",") : (sp[k] as string | undefined));
  const query: Record<string, string> = {};
  for (const k of FILTER_KEYS) { const v = one(k); if (v) query[k] = v; }
  const db = getDb(actor);
  let page;
  let error: string | null = null;
  try {
    page = await listPitches(db, actor, { ...query, ...(one("cursor") ? { cursor: one("cursor") } : {}), limit: view === "kanban" ? 100 : 25 });
  } catch (e) {
    if (e instanceof AppError && (e.code === "VALIDATION" || e.code === "FORBIDDEN")) error = e.message; else throw e;
  }
  const [lookups, stages, platformOpts, saved] = await Promise.all([getLookups(db), getActiveStages(db), getPlatformOptions(db), listSavedFilters(db, actor)]);
  const selected = (k: string) => new Set((query[k] ?? "").split(",").filter(Boolean));
  const qs = (extra: Record<string, string>) => `?${new URLSearchParams({ ...query, view, ...extra }).toString()}`;
  const check = (name: string, value: string, label: string) => (
    <label key={value}><input type="checkbox" name={name} value={value} defaultChecked={selected(name).has(value)} /> {label}</label>
  );

  return (
    <>
      <PageHeader title="Pitches" subtitle="Every story, where it is, and who has it."
        actions={<>
          <Link className={view === "table" ? "btn-inline" : "btn-secondary"} href={qs({ view: "table" })}>Table</Link>
          <Link className={view === "cards" ? "btn-inline" : "btn-secondary"} href={qs({ view: "cards" })}>Cards</Link>
          <Link className={view === "kanban" ? "btn-inline" : "btn-secondary"} href={qs({ view: "kanban" })}>Kanban</Link>
          {can(actor, "data.export") && <a className="btn-secondary" href={`/api/v1/exports?${new URLSearchParams({ kind: "pitches", ...Object.fromEntries(Object.entries(query).filter(([k]) => k !== "sort")) }).toString()}`}>Export CSV</a>}
          {can(actor, "pitch.create") && <Link className="btn-inline" href="/pitches/new">+ New pitch</Link>}
        </>} />

      {saved.length > 0 && (
        <div className="chips" aria-label="Saved filters">
          {saved.map((f) => <span key={f.id} className="chip"><Link href={`/pitches?${filterToSearchParams(f.query)}&view=${view}`}>{f.name}</Link> <DeleteFilter id={f.id} /></span>)}
        </div>
      )}

      <form method="get">
        <input type="hidden" name="view" value={view} />
        <div className="filters">
          <label className="field">Search<input name="q" defaultValue={query.q ?? ""} placeholder="Title, pitch ID, creator" /></label>
          <label className="field">Sort<select name="sort" defaultValue={query.sort ?? "newest"}>
            <option value="newest">Newest first</option><option value="oldest">Oldest first</option><option value="waiting">Waiting longest</option></select></label>
          <label className="field"><span><input type="checkbox" name="mine" value="1" defaultChecked={query.mine === "1"} /> Only with me</span></label>
          <button className="btn-inline">Apply</button>
          <Link className="btn-secondary" href={`/pitches?view=${view}`}>Clear</Link>
        </div>
        <details className="drawer" open={Object.keys(query).some((k) => !["q", "sort", "mine"].includes(k))}>
          <summary>More filters</summary>
          <div className="drawer-grid">
            <fieldset><legend>Creator</legend>{["WRITER", "DIRECTOR", "WRITER_DIRECTOR", "PRODUCER"].map((t) => check("creatorType", t, typeLabel(t)))}</fieldset>
            <fieldset><legend>Genre</legend>{(lookups.GENRE ?? []).map((l) => check("genre", l.key, l.label))}</fieldset>
            <fieldset><legend>Language</legend>{(lookups.LANGUAGE ?? []).map((l) => check("language", l.key, l.label))}</fieldset>
            <fieldset><legend>Format</legend>{(lookups.FORMAT ?? []).map((l) => check("format", l.key, l.label))}</fieldset>
            <fieldset><legend>Priority</legend>{["LOW", "MEDIUM", "HIGH", "URGENT"].map((p) => check("priority", p, p[0] + p.slice(1).toLowerCase()))}</fieldset>
            <fieldset><legend>Stage</legend>{stages.map((s) => check("stage", s.key, s.name))}</fieldset>
            <fieldset><legend>Workflow</legend>
              <label>Waiting at least (days)<input type="number" name="minDaysWaiting" min={0} defaultValue={query.minDaysWaiting ?? ""} /></label>
              <label>Created from<input type="date" name="createdFrom" defaultValue={query.createdFrom ?? ""} /></label>
              <label>Created to<input type="date" name="createdTo" defaultValue={query.createdTo ?? ""} /></label>
            </fieldset>
            <fieldset><legend>Platform</legend>
              <label>Platform<select name="platformId" defaultValue={query.platformId ?? ""}><option value="">Any</option>{platformOpts.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
              {Object.entries(PLATFORM_STATUS_LABEL).map(([k, l]) => check("platformStatus", k, l))}
            </fieldset>
            <fieldset><legend>Quality</legend>
              <label>Minimum average rating<select name="minRating" defaultValue={query.minRating ?? ""}><option value="">Any</option>{[4.5, 4, 3.5, 3].map((r) => <option key={r} value={r}>{r}+</option>)}</select></label>
              {can(actor, "pitch.restore") && <label><input type="checkbox" name="archived" value="1" defaultChecked={query.archived === "1"} /> Archived pitches</label>}
            </fieldset>
          </div>
          <div className="row-actions"><button className="btn-inline">Apply filters</button><SaveFilter query={query} /></div>
        </details>
      </form>

      {error && <p className="notice">{error}</p>}
      {page && page.items.length === 0 && <Empty>No pitches match.</Empty>}
      {page && page.items.length > 0 && view === "table" && (
        <div className="table-wrap"><table className="data">
          <thead><tr><th>Pitch</th><th>Creator</th><th>Format · Language</th><th>Status</th><th>With</th><th>Waiting</th><th>Rating</th><th>Updated</th></tr></thead>
          <tbody>{page.items.map((p) => (
            <tr key={p.id}>
              <td><Link href={`/pitches/${p.id}`}>{p.title}</Link><div className="muted">{p.pitchCode}{p.priority === "HIGH" || p.priority === "URGENT" ? ` · ${p.priority}` : ""}</div></td>
              <td>{p.creatorName}<div className="muted">{typeLabel(p.creatorType)}</div></td>
              <td>{labelOf(lookups, "FORMAT", p.formatKey)} · {labelOf(lookups, "LANGUAGE", p.languageKey)}</td>
              <td><StageBadge badge={p.stageBadge} label={p.stageName ?? p.currentStageKey} /></td>
              <td>{p.ownerName ?? "—"}</td>
              <td>{p.daysWaiting} d</td>
              <td><Stars value={p.avgRating} /></td>
              <td>{fmtDate(p.updatedAt)}</td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
      {page && page.items.length > 0 && view === "cards" && (
        <div className="pitch-cards">{page.items.map((p) => (
          <Link key={p.id} className="pitch-card" href={`/pitches/${p.id}`}>
            <h3>{p.title}</h3>
            <StageBadge badge={p.stageBadge} label={p.stageName ?? p.currentStageKey} />
            <dl>
              <dt>{typeLabel(p.creatorType)}</dt><dd>{p.creatorName}</dd>
              <dt>Genre</dt><dd>{labelOf(lookups, "GENRE", p.genreKey)}</dd>
              <dt>Format</dt><dd>{labelOf(lookups, "FORMAT", p.formatKey)}</dd>
              <dt>Language</dt><dd>{labelOf(lookups, "LANGUAGE", p.languageKey)}</dd>
              <dt>Current level</dt><dd>{p.stageName}</dd>
              <dt>With</dt><dd>{p.ownerName ?? "—"}</dd>
              <dt>Rating</dt><dd><Stars value={p.avgRating} /></dd>
              <dt>Waiting</dt><dd>{p.daysWaiting} days</dd>
              <dt>Updated</dt><dd>{fmtDate(p.updatedAt)}</dd>
            </dl>
          </Link>
        ))}</div>
      )}
      {page && view === "kanban" && (
        <KanbanBoard cards={page.items.map((p) => ({ id: p.id, title: p.title, creatorName: p.creatorName, stageKey: p.currentStageKey, stageName: p.stageName ?? p.currentStageKey, ownerName: p.ownerName, daysWaiting: p.daysWaiting }))} />
      )}
      {page?.nextCursor && <div className="pager"><Link className="btn-secondary" href={qs({ cursor: page.nextCursor })}>Next page →</Link></div>}
    </>
  );
}
