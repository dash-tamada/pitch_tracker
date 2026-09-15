"use client";

import { useState } from "react";
import { api } from "./client-api";

/** Advanced editor: edit the workflow as JSON and publish it as a new version (validated again on the server). */
export function WorkflowJsonEditor({ initial }: { initial: string }) {
  const [text, setText] = useState(initial);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <div className="section">
      <h2>Edit workflow (publishes a new version)</h2>
      <p className="subtle">Pitches already in progress keep the version they started on. Rules that cannot be switched off: a rejection needs a reason, a forward needs a recipient, a platform approval names the platform, approvals are marked as approvals.</p>
      {msg && <p className={msg.ok ? "success" : "error"}>{msg.text}</p>}
      <label className="field full"><span className="sr-only">Workflow JSON</span><textarea className="code" value={text} onChange={(e) => setText(e.target.value)} rows={24} spellCheck={false} /></label>
      <div className="row-actions"><button className="btn-inline" disabled={busy} onClick={async () => {
        setBusy(true); setMsg(null);
        try {
          const parsed = JSON.parse(text);
          const r = await api<{ version: number }>("POST", "/api/v1/admin/workflow", parsed);
          setMsg({ ok: true, text: `Published version ${r.version}.` });
        } catch (e) { setMsg({ ok: false, text: e instanceof SyntaxError ? "That is not valid JSON." : e instanceof Error ? e.message : "Failed" }); }
        finally { setBusy(false); }
      }}>Validate & publish new version</button></div>
    </div>
  );
}
