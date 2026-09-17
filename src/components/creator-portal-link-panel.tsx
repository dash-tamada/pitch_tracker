"use client";

import { useEffect, useState } from "react";
import { api, ApiError } from "./client-api";

/**
 * Company Admin's view of the one link every external creator uses to register and log in
 * (/portal/<token>). The plain token only ever exists in the POST response, right after it's
 * generated — the server stores just its hash (see tenancy/company.ts) and can never show it again,
 * so this panel is the only place it's ever visible. Rotating immediately invalidates the old link.
 */
export function CreatorPortalLinkPanel() {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [revealedUrl, setRevealedUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<{ enabled: boolean }>("GET", "/api/v1/company/creator-portal-link")
      .then((r) => setEnabled(r.enabled))
      .catch(() => setEnabled(false));
  }, []);

  async function rotate() {
    setBusy(true); setError(null); setCopied(false);
    try {
      const r = await api<{ portalPath: string }>("POST", "/api/v1/company/creator-portal-link");
      setRevealedUrl(window.location.origin + r.portalPath);
      setEnabled(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    if (!window.confirm("Disable the creator portal link? Creators will no longer be able to register or log in with it. Anyone already signed in stays signed in until their session expires.")) return;
    setBusy(true); setError(null);
    try {
      await api("DELETE", "/api/v1/company/creator-portal-link");
      setEnabled(false); setRevealedUrl(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    if (!revealedUrl) return;
    try { await navigator.clipboard.writeText(revealedUrl); setCopied(true); } catch { /* clipboard may be unavailable; the field is selectable either way */ }
  }

  return (
    <section className="section">
      <h2>Creator portal link</h2>
      <p className="subtle">Share this link with outside creators so they can register, log in, submit pitches, and upload documents — without a Pitch Tracker account.</p>
      {error && <p className="error" role="alert">{error}</p>}

      {revealedUrl && (
        <>
          <p className="notice">This link is shown only once. Copy it now — it can&apos;t be displayed again (rotate to get a new one if you lose it).</p>
          <div className="row-actions">
            <input readOnly value={revealedUrl} onFocus={(e) => e.currentTarget.select()} style={{ flex: 1, minWidth: 280 }} />
            <button type="button" className="btn-secondary" onClick={copy}>{copied ? "Copied" : "Copy"}</button>
          </div>
        </>
      )}

      {enabled === null ? null : enabled ? (
        <div className="row-actions">
          {!revealedUrl && <p className="subtle" style={{ margin: 0 }}>A link is active. It was only shown at the moment it was created.</p>}
          <button type="button" className="btn-secondary" disabled={busy} onClick={rotate}>{busy ? "Please wait…" : "Rotate link (invalidates the old one)"}</button>
          <button type="button" className="btn-secondary btn-danger" disabled={busy} onClick={disable}>Disable link</button>
        </div>
      ) : (
        <div className="row-actions">
          <button type="button" className="btn-inline" disabled={busy} onClick={rotate}>{busy ? "Please wait…" : "Generate link"}</button>
        </div>
      )}
    </section>
  );
}
