"use client";

import { useState, type FormEvent } from "react";
import { api, csrfHeader } from "./client-api";

type Opt = { key: string; label: string };

/**
 * Same three-step upload staff use (documents/service.ts / upload-panel.tsx): ask the server for a one-time
 * URL → send the file straight to private storage → ask the server to verify it. Nothing becomes a real
 * document until the server has independently checked the file's actual contents.
 */
export function PortalUploadPanel({ token, pitchId, categories }: { token: string; pitchId: string; categories: Opt[] }) {
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const file = f.get("file");
    if (!(file instanceof File) || file.size === 0) { setError("Choose a file."); return; }
    setBusy(true); setError(null);
    try {
      setStatus("Preparing secure upload…");
      const body: Record<string, unknown> = {
        pitchId, categoryKey: String(f.get("categoryKey") ?? ""), title: String(f.get("title") ?? "").trim(),
        filename: file.name, sizeBytes: file.size,
      };
      const versionLabel = String(f.get("versionLabel") ?? "").trim();
      if (versionLabel) body.versionLabel = versionLabel;
      const intent = await api<{ intentId: string; uploadUrl: string }>("POST", `/api/v1/portal/${token}/uploads`, body);

      setStatus("Uploading…");
      const sameOrigin = intent.uploadUrl.startsWith("/");
      const form = new FormData();
      form.append("cacheControl", "3600");
      form.append("", file);
      const put = await fetch(intent.uploadUrl, { method: "PUT", body: form, credentials: sameOrigin ? "same-origin" : "omit", headers: sameOrigin ? csrfHeader() : { "x-upsert": "false" } });
      if (!put.ok) throw new Error("Upload failed. Please try again.");

      setStatus("Checking the file…");
      await api("POST", `/api/v1/portal/${token}/uploads/${intent.intentId}/complete`);
      setStatus("Done.");
      window.location.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed.");
      setStatus(null);
      setBusy(false);
    }
  }

  return (
    <form className="section" onSubmit={submit}>
      <h2>Upload a document</h2>
      {error && <p className="error" role="alert">{error}</p>}
      {status && <p className="subtle" role="status">{status}</p>}
      <div className="form-grid">
        <label className="field full">File *<input type="file" name="file" accept=".pdf,.doc,.docx,.txt,.ppt,.pptx,.jpg,.jpeg,.png,.webp" required />
          <span className="hint">PDF, DOC, DOCX, TXT, PPT, PPTX, JPG, PNG or WEBP. Macro-enabled files are refused.</span></label>
        <label className="field">Category *<select name="categoryKey" required defaultValue="SCRIPT">
          {categories.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}</select></label>
        <label className="field">Title *<input name="title" required maxLength={200} placeholder="e.g. Script" /></label>
        <label className="field">Version label<input name="versionLabel" maxLength={60} placeholder="e.g. Second draft" /></label>
      </div>
      <div className="row-actions"><button className="btn-inline" disabled={busy}>{busy ? "Uploading…" : "Upload"}</button></div>
    </form>
  );
}
