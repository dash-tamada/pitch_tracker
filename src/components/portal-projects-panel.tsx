"use client";

import { useState } from "react";
import { api, ApiError } from "./client-api";

type Opt = { key: string; label: string };
type ExternalLink = { label: string; url: string };
export interface PortalProject {
  id: string; projectName: string; role: string; productionCompany: string | null; platformName: string | null;
  releaseYear: number | null; languageKey: string | null; genreKey: string | null; projectStatus: string | null;
  description: string | null; externalLinks: ExternalLink[];
}
const ROLES: Opt[] = [["WRITER", "Writer"], ["DIRECTOR", "Director"], ["WRITER_DIRECTOR", "Writer + Director"], ["PRODUCER", "Producer"], ["CREATOR", "Creator"], ["OTHER", "Other"]].map(([key, label]) => ({ key: key!, label: label! }));
type Draft = { projectName: string; role: string; productionCompany: string; platformName: string; releaseYear: string; languageKey: string; genreKey: string; projectStatus: string; description: string; link: string };
const emptyDraft = (): Draft => ({ projectName: "", role: "WRITER", productionCompany: "", platformName: "", releaseYear: "", languageKey: "", genreKey: "", projectStatus: "", description: "", link: "" });

/**
 * "Projects worked on" as an ongoing part of the portal profile, not a one-time bundle at creation like
 * staff's CreatorForm — a creator can add a project any time from "My profile", and remove one they no
 * longer want listed. "Remove" archives it (creator_edit_project RLS), it does not delete the row.
 */
export function PortalProjectsPanel({ token, languages, genres, initial }: { token: string; languages: Opt[]; genres: Opt[]; initial: PortalProject[] }) {
  const [projects, setProjects] = useState(initial);
  const [draft, setDraft] = useState<Draft>(emptyDraft());
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function addProject() {
    if (!draft.projectName.trim()) { setError("Project name is required."); return; }
    setError(null); setAdding(true);
    const externalLinks = draft.link.trim() ? [{ label: "Link", url: draft.link.trim() }] : [];
    try {
      const r = await api<{ id: string }>("POST", `/api/v1/portal/${token}/profile/projects`, {
        projectName: draft.projectName.trim(), role: draft.role,
        productionCompany: draft.productionCompany.trim() || undefined, platformName: draft.platformName.trim() || undefined,
        ...(draft.releaseYear ? { releaseYear: Number(draft.releaseYear) } : {}),
        languageKey: draft.languageKey || undefined, genreKey: draft.genreKey || undefined,
        projectStatus: draft.projectStatus.trim() || undefined, description: draft.description.trim() || undefined, externalLinks,
      });
      setProjects((ps) => [{
        id: r.id, projectName: draft.projectName.trim(), role: draft.role,
        productionCompany: draft.productionCompany.trim() || null, platformName: draft.platformName.trim() || null,
        releaseYear: draft.releaseYear ? Number(draft.releaseYear) : null, languageKey: draft.languageKey || null,
        genreKey: draft.genreKey || null, projectStatus: draft.projectStatus.trim() || null,
        description: draft.description.trim() || null, externalLinks,
      }, ...ps]);
      setDraft(emptyDraft());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally { setAdding(false); }
  }

  async function removeProject(id: string) {
    setBusyId(id); setError(null);
    try {
      await api("PATCH", `/api/v1/portal/${token}/profile/projects/${id}`, { archived: true });
      setProjects((ps) => ps.filter((p) => p.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally { setBusyId(null); }
  }

  return (
    <div className="section">
      <h2>Projects worked on</h2>
      <p className="subtle">These stay on your profile for future pitches.</p>
      {error && <p className="error" role="alert">{error}</p>}
      {projects.length > 0 && (
        <table className="data"><tbody>
          {projects.map((p) => (
            <tr key={p.id}>
              <td><strong>{p.projectName}</strong><div className="muted">{ROLES.find((r) => r.key === p.role)?.label ?? p.role}{p.releaseYear ? ` · ${p.releaseYear}` : ""}{p.platformName ? ` · ${p.platformName}` : ""}</div></td>
              <td><button type="button" className="btn-secondary" disabled={busyId === p.id} onClick={() => removeProject(p.id)}>{busyId === p.id ? "Removing…" : "Remove"}</button></td>
            </tr>
          ))}
        </tbody></table>
      )}
      <div className="form-grid section">
        <label className="field">Project name<input value={draft.projectName} onChange={(e) => setDraft({ ...draft, projectName: e.target.value })} /></label>
        <label className="field">Role<select value={draft.role} onChange={(e) => setDraft({ ...draft, role: e.target.value })}>{ROLES.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}</select></label>
        <label className="field">Production company<input value={draft.productionCompany} onChange={(e) => setDraft({ ...draft, productionCompany: e.target.value })} /></label>
        <label className="field">Platform / channel<input value={draft.platformName} onChange={(e) => setDraft({ ...draft, platformName: e.target.value })} /></label>
        <label className="field">Release year<input type="number" min={1900} max={2100} value={draft.releaseYear} onChange={(e) => setDraft({ ...draft, releaseYear: e.target.value })} /></label>
        <label className="field">Language<select value={draft.languageKey} onChange={(e) => setDraft({ ...draft, languageKey: e.target.value })}><option value="">—</option>{languages.map((l) => <option key={l.key} value={l.key}>{l.label}</option>)}</select></label>
        <label className="field">Genre<select value={draft.genreKey} onChange={(e) => setDraft({ ...draft, genreKey: e.target.value })}><option value="">—</option>{genres.map((g) => <option key={g.key} value={g.key}>{g.label}</option>)}</select></label>
        <label className="field">Status<input value={draft.projectStatus} placeholder="Released, In production…" onChange={(e) => setDraft({ ...draft, projectStatus: e.target.value })} /></label>
        <label className="field">External link<input type="url" placeholder="https://" value={draft.link} onChange={(e) => setDraft({ ...draft, link: e.target.value })} /></label>
        <label className="field full">Description<textarea value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} /></label>
        <div className="full"><button type="button" className="btn-secondary" disabled={adding} onClick={addProject}>{adding ? "Adding…" : "+ Add project"}</button></div>
      </div>
    </div>
  );
}
