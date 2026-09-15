"use client";

import { useState } from "react";
import { api } from "./client-api";

export function RoleEditor({ roleKey, all, granted, locked }: { roleKey: string; all: { key: string; description: string }[]; granted: string[]; locked: boolean }) {
  const [sel, setSel] = useState(new Set(granted));
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <details className="drawer">
      <summary>{roleKey.replaceAll("_", " ")} — {sel.size} permissions{locked ? " (read-only)" : ""}</summary>
      <div className="drawer-grid">{all.map((p) => (
        <label key={p.key} title={p.description}><input type="checkbox" disabled={locked} checked={sel.has(p.key)} onChange={(e) => {
          const n = new Set(sel); if (e.target.checked) n.add(p.key); else n.delete(p.key); setSel(n);
        }} /> {p.key}</label>
      ))}</div>
      {!locked && <div className="row-actions"><button className="btn-inline" onClick={async () => {
        setMsg(null);
        try { await api("PATCH", `/api/v1/admin/roles/${roleKey}`, { permissionKeys: [...sel] }); setMsg("Saved. Users with this role must sign in again."); }
        catch (e) { setMsg(e instanceof Error ? e.message : "Failed"); }
      }}>Save permissions</button>{msg && <span className="subtle">{msg}</span>}</div>}
    </details>
  );
}
