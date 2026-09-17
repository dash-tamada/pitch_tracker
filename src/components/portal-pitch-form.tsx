"use client";

import { useState, type FormEvent } from "react";
import { api, ApiError } from "./client-api";

type Opt = { key: string; label: string };
// Kept in sync with EPISODIC_FORMATS in creator-portal/pitch.ts — only these formats collect an episode count.
const EPISODIC_FORMATS = new Set(["WEB_SERIES", "TV_SERIES"]);

export function PortalPitchForm({ token, lookups }: { token: string; lookups: Record<string, Opt[]> }) {
  const [formatKey, setFormatKey] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const episodic = EPISODIC_FORMATS.has(formatKey);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null); setFields({}); setBusy(true);
    const f = new FormData(e.currentTarget);
    const s = (k: string) => String(f.get(k) ?? "").trim();
    const num = (k: string) => (s(k) ? Number(s(k)) : undefined);
    const body: Record<string, unknown> = {
      title: s("title"), logline: s("logline") || undefined, shortSynopsis: s("shortSynopsis") || undefined,
      detailedSynopsis: s("detailedSynopsis") || undefined, formatKey: s("formatKey"), languageKey: s("languageKey"),
      genreKey: s("genreKey") || undefined, targetAudience: s("targetAudience") || undefined, notes: s("notes") || undefined,
    };
    if (episodic && num("episodeCount") !== undefined) body.episodeCount = num("episodeCount");
    if (num("episodeDurationMin") !== undefined) body.episodeDurationMin = num("episodeDurationMin");
    try {
      const r = await api<{ pitchId: string }>("POST", `/api/v1/portal/${token}/pitches`, body);
      window.location.assign(`/portal/${token}/pitches/${r.pitchId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      if (err instanceof ApiError && err.fields) setFields(err.fields);
      setBusy(false);
    }
  }
  const sel = (name: string, type: string, required = false, onChange?: (v: string) => void) => (
    <select name={name} required={required} defaultValue="" onChange={onChange ? (e) => onChange(e.target.value) : undefined}>
      <option value="">{required ? "Choose…" : "—"}</option>
      {(lookups[type] ?? []).map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
    </select>
  );
  const fe = (k: string) => (fields[k] ? <span className="field-error">{fields[k]}</span> : null);

  return (
    <form onSubmit={submit} noValidate>
      {error && <p className="error" role="alert">{error}</p>}
      <div className="section">
        <h2>Pitch information</h2>
        <div className="form-grid">
          <label className="field full">Pitch name *<input name="title" required maxLength={200} />{fe("title")}</label>
          <label className="field full">One-line / logline<input name="logline" maxLength={500} /></label>
          <label className="field full">Short synopsis<textarea name="shortSynopsis" /></label>
          <label className="field full">Detailed synopsis<textarea name="detailedSynopsis" /></label>
          <label className="field">Format *{sel("formatKey", "FORMAT", true, setFormatKey)}{fe("formatKey")}</label>
          <label className="field">Language *{sel("languageKey", "LANGUAGE", true)}{fe("languageKey")}</label>
          <label className="field">Genre{sel("genreKey", "GENRE")}</label>
          {episodic && <label className="field">No. of episodes<input name="episodeCount" type="number" min={1} max={1000} />{fe("episodeCount")}</label>}
          <label className="field">{episodic ? "Episode duration (min)" : "Duration (min)"}<input name="episodeDurationMin" type="number" min={1} max={600} /></label>
          <label className="field">Target audience<input name="targetAudience" maxLength={200} /></label>
          <label className="field full">Any notes<textarea name="notes" maxLength={5000} /></label>
        </div>
      </div>
      <div className="row-actions"><button className="btn-inline" disabled={busy}>{busy ? "Submitting…" : "Submit pitch"}</button></div>
    </form>
  );
}
