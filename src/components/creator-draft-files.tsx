"use client";

import { useState, type FormEvent } from "react";
import { api, csrfHeader } from "./client-api";

type Opt = [string, string];
interface FileRow { id: string; title: string; categoryKey: string; originalFilename: string; sizeBytes: number }

/** Upload scripts and material to a draft: ask for a one-time URL, send the file straight to storage, then ask the server to verify it. */
export function CreatorDraftFiles({ draftId, files, categories, sentCount = 0 }: { draftId: string; files: FileRow[]; categories: Opt[]; sentCount?: number }) {
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function upload(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const file = f.get("file");
    if (!(file instanceof File) || file.size === 0) { setError("Choose a file."); return; }
    setBusy(true); setError(null);
    try {
      setStatus("Preparing secure upload…");
      const intent = await api<{ intentId: string; uploadUrl: string }>("POST", `/api/v1/creator/drafts/${draftId}/uploads`, {
        categoryKey: String(f.get("categoryKey") ?? ""), title: String(f.get("title") ?? "").trim(), filename: file.name, sizeBytes: file.size,
      });
      setStatus("Uploading…");
      const sameOrigin = intent.uploadUrl.startsWith("/");
      const form = new FormData();
      form.append("cacheControl", "3600");
      form.append("", file);
      const put = await fetch(intent.uploadUrl, { method: "PUT", body: form, credentials: sameOrigin ? "same-origin" : "omit", headers: sameOrigin ? csrfHeader() : { "x-upsert": "false" } });
      if (!put.ok) throw new Error("Upload failed. Please try again.");
      setStatus("Checking the file…");
      await api("POST", `/api/v1/creator/drafts/${draftId}/uploads/${intent.intentId}/complete`);
      window.location.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed.");
      setStatus(null); setBusy(false);
    }
  }

  async function remove(id: string) {
    if (!window.confirm("Remove this file?")) return;
    try { await api("DELETE", `/api/v1/creator/drafts/${draftId}/files/${id}`); window.location.reload(); }
    catch (err) { setError(err instanceof Error ? err.message : "Could not remove the file."); }
  }

  const mb = (n: number) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
  const label = (k: string) => categories.find(([key]) => key === k)?.[1] ?? k;

  return (
    <div className="section">
      <h2>Poster, scripts &amp; material</h2>
      <p className="subtle">Have a poster? Upload it with the category Poster. {sentCount > 0 ? `Anything you add here is also delivered to the ${sentCount} production house${sentCount === 1 ? "" : "s"} that already ${sentCount === 1 ? "has" : "have"} this pitch.` : "Documents can still be added after you pitch."}</p>
      {error && <p className="error" role="alert">{error}</p>}
      {files.length === 0 ? <p className="muted">No files yet.</p> : (
        <table className="data"><tbody>
          {files.map((f) => (
            <tr key={f.id}>
              <td><a href={`/api/v1/creator/drafts/${draftId}/files/${f.id}`}>{f.title}</a><div className="muted">{f.originalFilename}</div></td>
              <td>{label(f.categoryKey)}</td><td>{mb(f.sizeBytes)}</td>
              <td><button type="button" className="btn-secondary" onClick={() => remove(f.id)}>Remove</button></td>
            </tr>
          ))}
        </tbody></table>
      )}
      {(
        <form onSubmit={upload}>
          {status && <p className="subtle" role="status">{status}</p>}
          <div className="form-grid">
            <label className="field full">File *<input type="file" name="file" accept=".pdf,.doc,.docx,.txt,.ppt,.pptx,.jpg,.jpeg,.png,.webp" required />
              <span className="hint">PDF, DOC, DOCX, TXT, PPT, PPTX, JPG, PNG or WEBP. Macro-enabled files are refused.</span></label>
            <label className="field">Category *<select name="categoryKey" required defaultValue="SCRIPT">{categories.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
            <label className="field">Title *<input name="title" required maxLength={200} placeholder="e.g. Script, second draft" /></label>
          </div>
          <div className="row-actions"><button className="btn-inline" disabled={busy}>{busy ? "Uploading…" : "Upload"}</button></div>
        </form>
      )}
    </div>
  );
}
