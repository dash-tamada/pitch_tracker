"use client";

import { useCallback, useEffect, useState } from "react";
import { DocumentPreview } from "./document-preview";

type ViewData = { url: string; mime: string; filename: string };

/**
 * Opens the document as an elevated card in the same window (not a separate browser popup window) — a modal
 * overlay with a layered drop-shadow for depth, sized to the viewport. Data loads client-side from the /view
 * API (same access checks and logging as Download) so the modal can open instantly without a page navigation.
 */
export function DocumentViewButton({ versionId, label = "View" }: { versionId: string; label?: string }) {
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
      const res = await fetch(`/api/v1/document-versions/${versionId}/view`, { credentials: "same-origin" });
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
            {data && <DocumentPreview url={data.url} mime={data.mime} filename={data.filename} newTabHref={`/documents/${versionId}/preview`} />}
          </div>
        </div>
      )}
    </>
  );
}
