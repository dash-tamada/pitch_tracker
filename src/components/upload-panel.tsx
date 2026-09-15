"use client";

import { useState, type FormEvent } from "react";
import { api, csrfHeader } from "./client-api";

type Opt = { key: string; label: string };

/**
 * Three-step upload: ask the server for a one-time URL → send the file straight to private storage →
 * ask the server to verify it. Nothing is visible to anyone until the server has checked the file's real contents.
 */
export function UploadPanel({ kind, pitchId, creatorId, documentId, categories, title }: {
  kind: "DOCUMENT" | "IMAGE" | "CREATOR_PHOTO"; pitchId?: string; creatorId?: string; documentId?: string; categories?: Opt[]; title: string;
}) {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const accept = kind === "DOCUMENT" ? ".pdf,.doc,.docx,.txt,.ppt,.pptx,.jpg,.jpeg,.png,.webp" : ".jpg,.jpeg,.png,.webp";

  if (!open) return <button type="button" className="btn-secondary" onClick={() => setOpen(true)}>{title}</button>;

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const file = f.get("file");
    if (!(file instanceof File) || file.size === 0) { setError("Choose a file."); return; }
    setBusy(true); setError(null);
    try {
      setStatus("Preparing secure upload…");
      const body: Record<string, unknown> = { kind, filename: file.name, sizeBytes: file.size };
      if (kind === "CREATOR_PHOTO") body.creatorId = creatorId;
      else { body.pitchId = pitchId; body.categoryKey = String(f.get("categoryKey") ?? ""); }
      if (kind === "DOCUMENT") {
        if (documentId) body.documentId = documentId; else body.title = String(f.get("title") ?? "").trim();
        const label = String(f.get("versionLabel") ?? "").trim(); if (label) body.versionLabel = label;
        const notes = String(f.get("notes") ?? "").trim(); if (notes) body.notes = notes;
      }
      if (kind === "IMAGE") { const c = String(f.get("caption") ?? "").trim(); if (c) body.caption = c; }
      const intent = await api<{ intentId: string; uploadUrl: string }>("POST", "/api/v1/uploads", body);

      setStatus("Uploading…");
      const form = new FormData();
      form.append("cacheControl", "3600");
      form.append("", file);
      const sameOrigin = intent.uploadUrl.startsWith("/");
      const put = await fetch(intent.uploadUrl, { method: "PUT", body: form, credentials: sameOrigin ? "same-origin" : "omit", headers: sameOrigin ? csrfHeader() : { "x-upsert": "false" } });
      if (!put.ok) throw new Error("Upload failed. Please try again.");

      setStatus("Checking the file…");
      await api("POST", `/api/v1/uploads/${intent.intentId}/complete`);
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
      <h2>{title}</h2>
      {error && <p className="error" role="alert">{error}</p>}
      {status && <p className="subtle" role="status">{status}</p>}
      <div className="form-grid">
        <label className="field full">File *<input type="file" name="file" accept={accept} required />
          <span className="hint">{kind === "DOCUMENT" ? "PDF, DOC, DOCX, TXT, PPT, PPTX, JPG, PNG or WEBP — up to 50 MB. Macro-enabled files are refused." : "JPG, PNG or WEBP — up to 15 MB."}</span></label>
        {kind !== "CREATOR_PHOTO" && categories && (
          <label className="field">Category *<select name="categoryKey" required defaultValue={kind === "DOCUMENT" ? "SCRIPT" : ""}>
            {categories.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}</select></label>
        )}
        {kind === "DOCUMENT" && !documentId && <label className="field">Title *<input name="title" required maxLength={200} placeholder="e.g. Script" /></label>}
        {kind === "DOCUMENT" && <label className="field">Version label<input name="versionLabel" maxLength={60} placeholder="e.g. Second draft for Netflix" /></label>}
        {kind === "DOCUMENT" && <label className="field full">Notes<textarea name="notes" maxLength={2000} /></label>}
        {kind === "IMAGE" && <label className="field full">Caption<input name="caption" maxLength={300} /></label>}
      </div>
      <div className="row-actions"><button className="btn-inline" disabled={busy}>Upload</button><button type="button" className="btn-secondary" onClick={() => setOpen(false)}>Cancel</button></div>
    </form>
  );
}
