"use client";

import { useEffect, useState, type FormEvent } from "react";
import { api, ApiError } from "./client-api";

type Opt = { key: string; label: string };
export interface PitchInitial {
  id?: string; version?: number; title?: string; logline?: string | null; shortSynopsis?: string | null; detailedSynopsis?: string | null;
  genreKey?: string | null; subGenreKey?: string | null; formatKey?: string; languageKey?: string; episodeCount?: number | null; episodeDurationMin?: number | null;
  budgetRangeKey?: string | null; targetAudience?: string | null; priority?: string; confidentiality?: string; tags?: string[]; notes?: string | null;
  creatorId?: string; creatorName?: string;
}

export function PitchForm({ lookups, initial, allowedConfidentiality }: { lookups: Record<string, Opt[]>; initial?: PitchInitial; allowedConfidentiality: string[] }) {
  const editing = Boolean(initial?.id);
  const [creatorQ, setCreatorQ] = useState("");
  const [creatorOpts, setCreatorOpts] = useState<{ id: string; fullName: string; creatorType: string }[]>([]);
  const [creatorId, setCreatorId] = useState(initial?.creatorId ?? "");
  const [creatorName, setCreatorName] = useState(initial?.creatorName ?? "");
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (editing || creatorQ.trim().length < 2) { setCreatorOpts([]); return; }
    const t = setTimeout(() => {
      api<{ items: { id: string; fullName: string; creatorType: string }[] }>("GET", `/api/v1/creators?q=${encodeURIComponent(creatorQ)}&limit=10`)
        .then((r) => setCreatorOpts(r.items)).catch(() => setCreatorOpts([]));
    }, 250);
    return () => clearTimeout(t);
  }, [creatorQ, editing]);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true); setError(null); setFields({});
    const f = new FormData(e.currentTarget);
    const s = (k: string) => String(f.get(k) ?? "").trim();
    const num = (k: string) => (s(k) ? Number(s(k)) : undefined);
    const body: Record<string, unknown> = {
      title: s("title"), logline: s("logline"), shortSynopsis: s("shortSynopsis"), detailedSynopsis: s("detailedSynopsis"),
      genreKey: s("genreKey"), subGenreKey: s("subGenreKey"), formatKey: s("formatKey"), languageKey: s("languageKey"),
      budgetRangeKey: s("budgetRangeKey"), targetAudience: s("targetAudience"), priority: s("priority"), confidentiality: s("confidentiality"),
      tags: s("tags").split(",").map((t) => t.trim()).filter(Boolean), notes: s("notes"),
    };
    if (num("episodeCount") !== undefined) body.episodeCount = num("episodeCount");
    if (num("episodeDurationMin") !== undefined) body.episodeDurationMin = num("episodeDurationMin");
    try {
      if (editing) {
        await api("PATCH", `/api/v1/pitches/${initial!.id}`, { ...body, expectedVersion: initial!.version });
        window.location.assign(`/pitches/${initial!.id}`);
      } else {
        if (!creatorId) { setError("Choose the creator first."); setBusy(false); return; }
        const r = await api<{ id: string }>("POST", "/api/v1/pitches", { ...body, creatorId });
        window.location.assign(`/pitches/${r.id}?tab=documents&new=1`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      if (err instanceof ApiError && err.fields) setFields(err.fields);
      setBusy(false);
    }
  }
  const sel = (name: string, type: string, def?: string | null, required = false) => (
    <select name={name} defaultValue={def ?? ""} required={required}>
      <option value="">{required ? "Choose…" : "—"}</option>
      {(lookups[type] ?? []).map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
    </select>
  );
  const fe = (k: string) => fields[k] ? <span className="field-error">{fields[k]}</span> : null;

  return (
    <form onSubmit={submit} noValidate>
      {error && <p className="error" role="alert">{error}</p>}
      {!editing && (
        <div className="section">
          <h2>Creator / writer / director *</h2>
          {creatorId ? (
            <p>Selected: <strong>{creatorName}</strong> <button type="button" className="btn-secondary" onClick={() => { setCreatorId(""); setCreatorName(""); }}>Change</button></p>
          ) : (
            <>
              <label className="field">Search existing creators by name or mobile<input value={creatorQ} onChange={(e) => setCreatorQ(e.target.value)} /></label>
              <div className="chips">{creatorOpts.map((c) => <button type="button" key={c.id} className="btn-secondary" onClick={() => { setCreatorId(c.id); setCreatorName(c.fullName); }}>{c.fullName}</button>)}</div>
              <p className="subtle">Not listed? <a href="/creators/new">Create the creator profile</a> first, then start the pitch from their profile.</p>
            </>
          )}
        </div>
      )}
      <div className="section">
        <h2>Pitch information</h2>
        <div className="form-grid">
          <label className="field full">Pitch name *<input name="title" required maxLength={200} defaultValue={initial?.title ?? ""} />{fe("title")}</label>
          <label className="field full">One-line / logline<input name="logline" maxLength={500} defaultValue={initial?.logline ?? ""} /></label>
          <label className="field full">Short synopsis<textarea name="shortSynopsis" defaultValue={initial?.shortSynopsis ?? ""} /></label>
          <label className="field full">Detailed synopsis<textarea name="detailedSynopsis" defaultValue={initial?.detailedSynopsis ?? ""} /></label>
          <label className="field">Format *{sel("formatKey", "FORMAT", initial?.formatKey, true)}{fe("format")}</label>
          <label className="field">Language *{sel("languageKey", "LANGUAGE", initial?.languageKey, true)}{fe("language")}</label>
          <label className="field">Genre{sel("genreKey", "GENRE", initial?.genreKey)}</label>
          <label className="field">Sub-genre{sel("subGenreKey", "SUB_GENRE", initial?.subGenreKey)}</label>
          <label className="field">Number of episodes<input name="episodeCount" type="number" min={1} max={1000} defaultValue={initial?.episodeCount ?? ""} />{fe("episodeCount")}</label>
          <label className="field">Episode duration (min)<input name="episodeDurationMin" type="number" min={1} max={600} defaultValue={initial?.episodeDurationMin ?? ""} /></label>
          <label className="field">Estimated budget range{sel("budgetRangeKey", "BUDGET_RANGE", initial?.budgetRangeKey)}</label>
          <label className="field">Target audience<input name="targetAudience" maxLength={200} defaultValue={initial?.targetAudience ?? ""} /></label>
          <label className="field">Priority<select name="priority" defaultValue={initial?.priority ?? "MEDIUM"}>{["LOW", "MEDIUM", "HIGH", "URGENT"].map((p) => <option key={p} value={p}>{p}</option>)}</select></label>
          <label className="field">Confidentiality<select name="confidentiality" defaultValue={initial?.confidentiality ?? "CONFIDENTIAL"}>{allowedConfidentiality.map((c) => <option key={c} value={c}>{c}</option>)}</select>
            <span className="hint">RESTRICTED pitches are visible only to explicitly involved people and CEO/COO.</span>{fe("confidentiality")}</label>
          <label className="field full">Tags<input name="tags" placeholder="Comma separated" defaultValue={initial?.tags?.join(", ") ?? ""} /></label>
          <label className="field full">Notes<textarea name="notes" defaultValue={initial?.notes ?? ""} /></label>
        </div>
      </div>
      <div className="row-actions"><button className="btn-inline" disabled={busy}>{editing ? "Save changes" : "Submit pitch"}</button></div>
    </form>
  );
}
