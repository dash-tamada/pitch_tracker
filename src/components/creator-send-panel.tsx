"use client";

import { useState, type FormEvent } from "react";
import { api } from "./client-api";

interface House { id: string; name: string }
interface Result { companyId: string; company: string; ok: boolean; error?: string; filesFailed?: number }

/**
 * "Pitch to": the production houses that are accepting pitches. Pick one or several and send. Houses that already have this
 * pitch are shown as sent. The pitch stays editable, and files added later reach every house that already has it.
 */
export function CreatorSendPanel({ draftId, houses, sentIds }: { draftId: string; houses: House[]; sentIds: string[] }) {
  const [picked, setPicked] = useState<string[]>([]);
  const [results, setResults] = useState<Result[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const sent = new Set(sentIds);
  const open = houses.filter((h) => !sent.has(h.id));
  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!picked.length) { setError("Choose at least one production house."); return; }
    setError(null); setBusy(true);
    try {
      const r = await api<{ results: Result[] }>("POST", `/api/v1/creator/drafts/${draftId}/send`, { companyIds: picked });
      setResults(r.results); setPicked([]); setBusy(false);
      if (r.results.every((x) => x.ok)) window.setTimeout(() => window.location.reload(), 1400);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
      setBusy(false);
    }
  }

  return (
    <form className="section" id="pitch-to" onSubmit={submit}>
      <h2>Pitch to</h2>
      <p className="subtle">Production houses accepting pitches right now. Send this pitch to as many as you like — you can keep editing it and adding documents, and every house that has it gets the updates.</p>
      {error && <p className="error" role="alert">{error}</p>}
      {results && (
        <ul className="send-results" role="status">
          {results.map((r) => <li key={r.companyId} className={r.ok ? "ok" : "bad"}>{r.ok ? `Sent to ${r.company}.` : `${r.company}: ${r.error}`}{r.ok && r.filesFailed ? ` ${r.filesFailed} file(s) could not be delivered.` : ""}</li>)}
        </ul>
      )}
      {houses.length === 0 ? <p className="muted">No production house is accepting pitches yet.</p> : (
        <>
          <ul className="house-pick">
            {houses.map((h) => sent.has(h.id)
              ? <li key={h.id} className="sent"><span>{h.name}</span><span className="badge b-approved">Pitched</span></li>
              : <li key={h.id}><label><input type="checkbox" checked={picked.includes(h.id)} onChange={() => toggle(h.id)} /> {h.name}</label></li>)}
          </ul>
          {open.length > 0 && <div className="row-actions"><button className="btn-inline" disabled={busy || !picked.length}>{busy ? "Sending…" : picked.length > 1 ? `Pitch to ${picked.length} houses` : "Pitch"}</button></div>}
        </>
      )}
    </form>
  );
}
