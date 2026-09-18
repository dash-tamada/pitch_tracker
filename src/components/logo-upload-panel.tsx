"use client";

import { useState, type FormEvent } from "react";
import { api, ApiError, csrfHeader } from "./client-api";

/**
 * Same three-step secure upload as UploadPanel (ask for a one-time URL → PUT the file straight to private
 * storage → ask the server to verify it), but against the company logo's own small self-contained endpoints
 * (tenancy/company.ts) rather than the pitch/document upload_intents table — see that module's own comment
 * for why. Company Admin only (company.manage), enforced again server-side regardless of what this renders.
 */
export function LogoUploadPanel({ hasLogo, logoUrl, companyName }: { hasLogo: boolean; logoUrl: string | null; companyName: string }) {
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const file = f.get("file");
    if (!(file instanceof File) || file.size === 0) { setError("Choose an image."); return; }
    setBusy(true); setError(null);
    try {
      setStatus("Preparing secure upload…");
      const intent = await api<{ uploadUrl: string; quarantineKey: string }>("POST", "/api/v1/company/logo/upload-url", { filename: file.name, sizeBytes: file.size });

      setStatus("Uploading…");
      const sameOrigin = intent.uploadUrl.startsWith("/");
      const form = new FormData();
      form.append("cacheControl", "3600");
      form.append("", file);
      const put = await fetch(intent.uploadUrl, { method: "PUT", body: form, credentials: sameOrigin ? "same-origin" : "omit", headers: sameOrigin ? csrfHeader() : { "x-upsert": "false" } });
      if (!put.ok) throw new Error("Upload failed. Please try again.");

      setStatus("Checking the file…");
      await api("POST", "/api/v1/company/logo/complete", { quarantineKey: intent.quarantineKey, filename: file.name, sizeBytes: file.size });
      setStatus("Done.");
      window.location.reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Upload failed.");
      setStatus(null);
      setBusy(false);
    }
  }

  async function remove() {
    if (!window.confirm("Remove the company logo?")) return;
    setBusy(true); setError(null);
    try {
      await api("DELETE", "/api/v1/company/logo");
      window.location.reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not remove the logo.");
      setBusy(false);
    }
  }

  return (
    <form className="section" onSubmit={submit}>
      <h2>Logo</h2>
      <p className="subtle">Shown next to your company name in the sidebar. JPG, PNG or WEBP, up to 2 MB.</p>
      {logoUrl && (
        // eslint-disable-next-line @next/next/no-img-element -- redirects to a signed, time-limited storage URL, not a static asset next/image can optimize
        <img className="logo-preview" src={logoUrl} alt={`${companyName} logo`} />
      )}
      {error && <p className="error" role="alert">{error}</p>}
      {status && <p className="subtle" role="status">{status}</p>}
      <div className="form-grid">
        <label className="field full">File<input type="file" name="file" accept=".jpg,.jpeg,.png,.webp" /></label>
      </div>
      <div className="row-actions">
        <button className="btn-inline" disabled={busy}>{hasLogo ? "Replace logo" : "Upload logo"}</button>
        {hasLogo && <button type="button" className="btn-secondary btn-danger" disabled={busy} onClick={remove}>Remove logo</button>}
      </div>
    </form>
  );
}
