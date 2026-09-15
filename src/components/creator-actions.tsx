"use client";

import { useState, type FormEvent } from "react";
import { api, ApiError } from "./client-api";

export function ArchiveCreatorButton({ id, archived }: { id: string; archived: boolean }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <button className="btn-secondary" disabled={busy} onClick={async () => {
        setBusy(true); setError(null);
        try { await api("POST", `/api/v1/creators/${id}/archive`, { archived: !archived }); window.location.reload(); }
        catch (e) { setError(e instanceof Error ? e.message : "Failed"); setBusy(false); }
      }}>{archived ? "Restore" : "Archive"}</button>
      {error && <span className="field-error">{error}</span>}
    </>
  );
}

export function AddProjectForm({ creatorId }: { creatorId: string }) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (!open) return <button className="btn-secondary" onClick={() => setOpen(true)}>+ Add project</button>;
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); setBusy(true); setError(null);
    const f = new FormData(e.currentTarget);
    const s = (k: string) => String(f.get(k) ?? "").trim();
    try {
      await api("POST", `/api/v1/creators/${creatorId}/projects`, {
        projectName: s("projectName"), role: s("role"), productionCompany: s("productionCompany"), platformName: s("platformName"),
        ...(s("releaseYear") ? { releaseYear: Number(s("releaseYear")) } : {}), projectStatus: s("projectStatus"), description: s("description"),
        externalLinks: s("link") ? [{ label: "Link", url: s("link") }] : [],
      });
      window.location.reload();
    } catch (err) {
      setError(err instanceof ApiError && err.fields ? Object.entries(err.fields).map(([k, v]) => `${k}: ${v}`).join("; ") : err instanceof Error ? err.message : "Failed");
      setBusy(false);
    }
  }
  return (
    <form className="section" onSubmit={submit}>
      <h2>Add project</h2>
      {error && <p className="error">{error}</p>}
      <div className="form-grid">
        <label className="field">Project name *<input name="projectName" required /></label>
        <label className="field">Role<select name="role">{["WRITER", "DIRECTOR", "WRITER_DIRECTOR", "PRODUCER", "CREATOR", "OTHER"].map((r) => <option key={r}>{r}</option>)}</select></label>
        <label className="field">Production company<input name="productionCompany" /></label>
        <label className="field">Platform / channel<input name="platformName" /></label>
        <label className="field">Release year<input name="releaseYear" type="number" min={1900} max={2100} /></label>
        <label className="field">Status<input name="projectStatus" /></label>
        <label className="field">Link<input name="link" type="url" placeholder="https://" /></label>
        <label className="field full">Description<textarea name="description" /></label>
      </div>
      <div className="row-actions"><button className="btn-inline" disabled={busy}>Save project</button><button type="button" className="btn-secondary" onClick={() => setOpen(false)}>Cancel</button></div>
    </form>
  );
}
