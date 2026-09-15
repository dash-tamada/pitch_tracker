"use client";

import { useState } from "react";
import { api } from "./client-api";

export function SaveFilter({ query }: { query: Record<string, string> }) {
  const [name, setName] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <span className="head-actions">
      <input aria-label="Filter name" placeholder="Save this filter as…" value={name} onChange={(e) => setName(e.target.value)} />
      <button type="button" className="btn-secondary" disabled={!name.trim()} onClick={async () => {
        try { await api("POST", "/api/v1/saved-filters", { name, query }); window.location.reload(); } catch (e) { setMsg(e instanceof Error ? e.message : "Failed"); }
      }}>Save filter</button>
      {msg && <span className="field-error">{msg}</span>}
    </span>
  );
}

export function DeleteFilter({ id }: { id: string }) {
  return <button type="button" className="btn-secondary" aria-label="Delete saved filter" onClick={async () => { await api("DELETE", `/api/v1/saved-filters/${id}`); window.location.reload(); }}>×</button>;
}
