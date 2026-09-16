"use client";

import { useState } from "react";
import { api } from "./client-api";

type View = { people: { id: string; email: string; fullName: string; status: string; mfaEnabled: boolean; roles: string[] }[]; roles: { key: string; name: string }[];
  recentActivity: { createdAt: string; action: string; resourceType: string }[] };

/** Requests an audited support grant and shows the read-only configuration view. Nothing is cached in the browser. */
export function SupportPanel({ companyId, activeGrantId, activeUntil }: { companyId: string; activeGrantId: string | null; activeUntil: string | null }) {
  const [view, setView] = useState<View | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<void>) => { setBusy(true); setError(null); try { await fn(); } catch (e) { setError(e instanceof Error ? e.message : "Failed"); } finally { setBusy(false); } };
  return (
    <div>
      {error && <p className="error" role="alert">{error}</p>}
      {!activeGrantId ? (
        <form onSubmit={(e) => { e.preventDefault(); const f = new FormData(e.currentTarget);
          void run(async () => { await api("POST", `/api/v1/platform/companies/${companyId}/support-access`, { reason: f.get("reason"), minutes: Number(f.get("minutes")) }); window.location.reload(); }); }}>
          <label className="field">Reason (min 10 characters, visible to the company)<input name="reason" required minLength={10} maxLength={500} /></label>
          <label className="field">Duration<select name="minutes" defaultValue="60"><option value="15">15 minutes</option><option value="60">1 hour</option><option value="240">4 hours</option></select></label>
          <button className="btn-inline" disabled={busy}>Request support access</button>
        </form>
      ) : (
        <div className="row-actions">
          <span className="subtle">Access active until {new Date(activeUntil!).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}</span>
          <button className="btn-inline" disabled={busy} onClick={() => void run(async () => setView(await api<View>("GET", `/api/v1/platform/companies/${companyId}/support-access`)))}>Open support view</button>
          <button className="btn-secondary" disabled={busy} onClick={() => void run(async () => { await api("POST", `/api/v1/platform/support-access/${activeGrantId}/revoke`); window.location.reload(); })}>End access now</button>
        </div>
      )}
      {view && (
        <div className="table-wrap"><table className="data">
          <thead><tr><th>Name</th><th>Email</th><th>Roles</th><th>Status</th><th>MFA</th></tr></thead>
          <tbody>{view.people.map((p) => <tr key={p.id}><td>{p.fullName}</td><td>{p.email}</td><td>{p.roles.join(", ")}</td><td>{p.status}</td><td>{p.mfaEnabled ? "On" : "Off"}</td></tr>)}</tbody>
        </table>
        <h3>Recent activity</h3>
        <ul>{view.recentActivity.slice(0, 30).map((a, i) => <li key={i}>{new Date(a.createdAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })} · {a.action}</li>)}</ul></div>
      )}
    </div>
  );
}
