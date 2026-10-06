"use client";

import { useState, type FormEvent } from "react";
import { api } from "./client-api";

/** Pick a company and send the pitch (and its files) to it. After this the pitch belongs to that company's pipeline. */
export function CreatorSendPanel({ draftId, companies }: { draftId: string; companies: { id: string; name: string }[] }) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const companyId = String(new FormData(e.currentTarget).get("companyId") ?? "");
    const name = companies.find((c) => c.id === companyId)?.name ?? "this company";
    if (!companyId) { setError("Choose a company."); return; }
    if (!window.confirm(`Send this pitch and its files to ${name}? You will not be able to edit it afterwards.`)) return;
    setError(null); setBusy(true);
    try {
      await api("POST", `/api/v1/creator/drafts/${draftId}/send`, { companyId });
      window.location.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
      setBusy(false);
    }
  }

  return (
    <form className="section" onSubmit={submit}>
      <h2>Send to a company</h2>
      <p className="subtle">When your pitch and script are ready, send them to a company on Pitch Tracker. They review it and get back to you.</p>
      {error && <p className="error" role="alert">{error}</p>}
      {companies.length === 0 ? <p className="muted">No companies are accepting pitches yet.</p> : (
        <>
          <label className="field">Company<select name="companyId" required defaultValue=""><option value="" disabled>Select a company…</option>
            {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
          <div className="row-actions"><button className="btn-inline" disabled={busy}>{busy ? "Sending…" : "Send pitch"}</button></div>
        </>
      )}
    </form>
  );
}
