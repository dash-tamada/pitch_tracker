"use client";

import { useState, type FormEvent } from "react";
import { api } from "./client-api";

type Opt = [string, string];
interface Draft {
  id?: string; title?: string; logline?: string | null; shortSynopsis?: string | null; detailedSynopsis?: string | null;
  formatKey?: string | null; languageKey?: string | null; genreKey?: string | null; episodeCount?: number | null; episodeDurationMin?: number | null;
  targetAudience?: string | null; notes?: string | null;
}
const EPISODIC = new Set(["WEB_SERIES", "TV_SERIES"]);

/** Create a pitch draft, or edit one. Nothing leaves the creator's own account until it is sent to a company. */
export function CreatorDraftForm({ draft, formats, languages, genres, readOnly = false }: { draft?: Draft; formats: Opt[]; languages: Opt[]; genres: Opt[]; readOnly?: boolean }) {
  const [format, setFormat] = useState(draft?.formatKey ?? "");
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null); setNote(null); setBusy(true);
    const f = new FormData(e.currentTarget);
    const s = (k: string) => String(f.get(k) ?? "").trim();
    const n = (k: string) => (s(k) ? Number(s(k)) : undefined);
    const body: Record<string, unknown> = { title: s("title"), logline: s("logline"), shortSynopsis: s("shortSynopsis"), detailedSynopsis: s("detailedSynopsis"), targetAudience: s("targetAudience"), notes: s("notes") };
    for (const k of ["formatKey", "languageKey", "genreKey"]) if (s(k)) body[k] = s(k);
    if (EPISODIC.has(format) && n("episodeCount")) body.episodeCount = n("episodeCount");
    if (n("episodeDurationMin")) body.episodeDurationMin = n("episodeDurationMin");
    try {
      if (draft?.id) { await api("PATCH", `/api/v1/creator/drafts/${draft.id}`, body); setNote("Saved."); setBusy(false); }
      else { const r = await api<{ id: string }>("POST", "/api/v1/creator/drafts", body); window.location.assign(`/creator/drafts/${r.id}`); }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
      setBusy(false);
    }
  }

  const sel = (name: string, label: string, opts: Opt[], value: string | null | undefined, onChange?: (v: string) => void) => (
    <label className="field">{label}
      <select name={name} defaultValue={value ?? ""} disabled={readOnly} onChange={onChange ? (e) => onChange(e.target.value) : undefined}>
        <option value="">Select…</option>{opts.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
      </select>
    </label>
  );

  return (
    <form className="section" onSubmit={submit} noValidate>
      <h2>{draft?.id ? "Your pitch" : "New pitch"}</h2>
      {error && <p className="error" role="alert">{error}</p>}
      {note && <p className="success" role="status">{note}</p>}
      <div className="form-grid">
        <label className="field full">Title *<input name="title" defaultValue={draft?.title ?? ""} maxLength={200} required disabled={readOnly} /></label>
        <label className="field full">One-line (logline)<input name="logline" defaultValue={draft?.logline ?? ""} maxLength={500} disabled={readOnly} /></label>
        {sel("formatKey", "Format", formats, draft?.formatKey, setFormat)}
        {sel("languageKey", "Language", languages, draft?.languageKey)}
        {sel("genreKey", "Genre", genres, draft?.genreKey)}
        {EPISODIC.has(format) && <label className="field">Number of episodes<input name="episodeCount" type="number" min={1} max={1000} defaultValue={draft?.episodeCount ?? ""} disabled={readOnly} /></label>}
        <label className="field">{EPISODIC.has(format) ? "Minutes per episode" : "Duration (minutes)"}<input name="episodeDurationMin" type="number" min={1} max={600} defaultValue={draft?.episodeDurationMin ?? ""} disabled={readOnly} /></label>
        <label className="field">Target audience<input name="targetAudience" defaultValue={draft?.targetAudience ?? ""} maxLength={200} disabled={readOnly} /></label>
        <label className="field full">Short synopsis<textarea name="shortSynopsis" rows={4} defaultValue={draft?.shortSynopsis ?? ""} maxLength={5000} disabled={readOnly} /></label>
        <label className="field full">Detailed synopsis<textarea name="detailedSynopsis" rows={8} defaultValue={draft?.detailedSynopsis ?? ""} maxLength={100000} disabled={readOnly} /></label>
        <label className="field full">Notes for the company<textarea name="notes" rows={3} defaultValue={draft?.notes ?? ""} maxLength={5000} disabled={readOnly} /></label>
      </div>
      {!readOnly && <div className="row-actions"><button className="btn-inline" disabled={busy}>{busy ? "Saving…" : draft?.id ? "Save changes" : "Create pitch"}</button></div>}
    </form>
  );
}
