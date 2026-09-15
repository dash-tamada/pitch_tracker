"use client";

import { useState, type FormEvent } from "react";
import { api } from "./client-api";

export function RatingCategoryForm({ pitchId, cats }: { pitchId: string; cats: { key: string; label: string }[] }) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (!open) return <button type="button" className="btn-secondary" onClick={() => setOpen(true)}>+ Detailed rating by category</button>;
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const overall = Number(f.get("overall"));
    const scores = cats.map((c) => ({ categoryKey: c.key, score: Number(f.get(c.key)) })).filter((s) => s.score >= 1);
    if (!overall) { setError("Choose an overall rating."); return; }
    setBusy(true); setError(null);
    try {
      await api("POST", `/api/v1/pitches/${pitchId}/ratings`, { overall, scores, ...(String(f.get("comments") ?? "").trim() ? { comments: String(f.get("comments")).trim() } : {}) });
      window.location.reload();
    } catch (err) { setError(err instanceof Error ? err.message : "Failed"); setBusy(false); }
  }
  const stars = (name: string) => (
    <select name={name} defaultValue=""><option value="">—</option>{[5, 4, 3, 2, 1].map((n) => <option key={n} value={n}>{"★".repeat(n)}{"☆".repeat(5 - n)}</option>)}</select>
  );
  return (
    <form className="section" onSubmit={submit}>
      <h2>Rate by category</h2>
      {error && <p className="error">{error}</p>}
      <div className="form-grid">
        {cats.map((c) => <label key={c.key} className="field">{c.label}{stars(c.key)}</label>)}
        <label className="field">Overall *{stars("overall")}</label>
        <label className="field full">Comments<textarea name="comments" maxLength={5000} /></label>
      </div>
      <div className="row-actions"><button className="btn-inline" disabled={busy}>Save rating</button><button type="button" className="btn-secondary" onClick={() => setOpen(false)}>Cancel</button></div>
    </form>
  );
}
