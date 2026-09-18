"use client";

import { useCallback, useEffect, useState } from "react";
import { DocumentPreview } from "./document-preview";

type ViewData = { url: string; mime: string; filename: string };

/**
 * Opens the document as an elevated card in the same window (not a separate browser popup window) — a modal
 * overlay with a layered drop-shadow for depth, sized to the viewport. Data loads client-side from the /view
 * API (same access checks and logging as Download) so the modal can open instantly without a page navigation.
 *
 * `viewUrl`/`newTabHref` default to the staff-session endpoints; the creator portal passes its own
 * (`/api/v1/portal/[token]/.../view`), which runs on the pitch_creator role instead — a staff session
 * fetching the default URL there would just get UNAUTHENTICATED, so this is a required override, not
 * cosmetic. `newTabHref` is entirely optional: pages that omit it (the portal, for now — its documents have
 * no standalone full-page preview route yet) simply don't render the "Open in new tab" link.
 */
export function DocumentViewButton({ versionId, label = "View", viewUrl, newTabHref }: { versionId: string; label?: string; viewUrl?: string; newTabHref?: string }) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<ViewData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, close]);

  async function openModal() {
    setOpen(true);
    setError(null);
    setData(null);
    setLoading(true);
    try {
      const res = await fetch(viewUrl ?? `/api/v1/document-versions/${versionId}/view`, { credentials: "same-origin" });
      if (!res.ok) throw new Error(res.status === 429 ? "Too many previews — wait a moment and try again." : "Could not load this document.");
      setData(await res.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load this document.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <button type="button" className="btn-secondary" onClick={openModal}>{label}</button>
      {open && (
        <div className="doc-modal-backdrop" onClick={close}>
          <div className="doc-modal-card" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={data?.filename ?? "Document preview"}>
            <button type="button" className="doc-modal-close" onClick={close} aria-label="Close preview">×</button>
            {loading && <p className="doc-preview-status" style={{ color: "#efe9f3", textAlign: "center", paddingTop: 40 }}>Loading…</p>}
            {error && <p className="doc-preview-status" style={{ color: "#efe9f3", textAlign: "center", paddingTop: 40 }}>{error}</p>}
            {/* The staff full-page preview route only understands staff-session document ids — default to it
                only when this button is also using the default (staff) viewUrl; a caller with a custom
                viewUrl (the portal) gets no "Open in new tab" link unless it passes its own newTabHref. */}
            {data && <DocumentPreview url={data.url} mime={data.mime} filename={data.filename} newTabHref={newTabHref ?? (viewUrl ? undefined : `/documents/${versionId}/preview`)} />}
          </div>
        </div>
      )}
    </>
  );
}
