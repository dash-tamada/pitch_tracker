"use client";

import { useEffect, useRef, useState } from "react";

type Props = { url: string; mime: string; filename: string; newTabHref?: string };

const MIN_SCALE = 0.5;
const MAX_SCALE = 2.5;

/**
 * Renders a document inline, inside our own chrome, instead of navigating the browser to the raw file.
 * That distinction matters: navigating a browser tab straight to a PDF hands control to the browser's own
 * PDF plugin, which always shows its full native toolbar (zoom, rotate, print, download, page thumbnails) —
 * there is no HTTP header or URL parameter that suppresses it. Fetching the bytes ourselves and drawing PDF
 * pages onto a <canvas> (via pdf.js) means there is no native toolbar to show in the first place: what's on
 * screen is only what this component renders, which is exactly "prev/next page" and "zoom" — no print, no
 * download, no save-as affordance.
 */
export function DocumentPreview({ url, mime, filename, newTabHref }: Props) {
  if (mime === "application/pdf") return <PdfPreview url={url} filename={filename} newTabHref={newTabHref} />;
  if (mime.startsWith("image/")) return <ImagePreview url={url} filename={filename} newTabHref={newTabHref} />;
  if (mime === "text/plain") return <TextPreview url={url} filename={filename} newTabHref={newTabHref} />;
  return (
    <Shell filename={filename} newTabHref={newTabHref}>
      <p className="doc-preview-status">
        Preview isn&apos;t available for this file type in the browser. Ask whoever shared it for the Download option instead.
      </p>
    </Shell>
  );
}

function Shell({ filename, toolbar, newTabHref, children }: { filename: string; toolbar?: React.ReactNode; newTabHref?: string; children: React.ReactNode }) {
  return (
    <div className="doc-preview" onContextMenu={(e) => e.preventDefault()}>
      <div className="doc-preview-bar">
        <span className="name" title={filename}>{filename}</span>
        <span className="spacer" />
        {toolbar}
        {newTabHref && <a href={newTabHref} target="_blank" rel="noopener noreferrer">Open in new tab ⤢</a>}
      </div>
      <div className="doc-preview-body">{children}</div>
      <div className="doc-preview-print-notice">Printing is disabled for this document.</div>
    </div>
  );
}

function ImagePreview({ url, filename, newTabHref }: { url: string; filename: string; newTabHref?: string }) {
  return (
    <Shell filename={filename} newTabHref={newTabHref}>
      {/* eslint-disable-next-line @next/next/no-img-element -- signed, short-lived, non-public URL; next/image would need a remote-pattern allowance for it */}
      <img src={url} alt={filename} draggable={false} />
    </Shell>
  );
}

function TextPreview({ url, filename, newTabHref }: { url: string; filename: string; newTabHref?: string }) {
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetch(url).then((r) => {
      if (!r.ok) throw new Error(`Could not load the file (${r.status}).`);
      return r.text();
    }).then((t) => { if (!cancelled) setText(t); }).catch((e) => { if (!cancelled) setError(String(e.message ?? e)); });
    return () => { cancelled = true; };
  }, [url]);
  return (
    <Shell filename={filename} newTabHref={newTabHref}>
      {error ? <p className="doc-preview-status">{error}</p> : text === null ? <p className="doc-preview-status">Loading…</p> : <pre>{text}</pre>}
    </Shell>
  );
}

function PdfPreview({ url, filename, newTabHref }: { url: string; filename: string; newTabHref?: string }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const docRef = useRef<import("pdfjs-dist").PDFDocumentProxy | null>(null);
  const renderTaskRef = useRef<{ cancel: () => void } | null>(null);
  const [numPages, setNumPages] = useState(0);
  const [page, setPage] = useState(1);
  const [scale, setScale] = useState(1.1);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [errorMsg, setErrorMsg] = useState("");

  // Load the document once.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const pdfjsLib = await import("pdfjs-dist");
        pdfjsLib.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
        const pdf = await pdfjsLib.getDocument({ url }).promise;
        if (cancelled) { pdf.destroy(); return; }
        docRef.current = pdf;
        setNumPages(pdf.numPages);
        setStatus("ready");
      } catch (e) {
        if (!cancelled) { setErrorMsg(e instanceof Error ? e.message : "Could not open this PDF."); setStatus("error"); }
      }
    })();
    return () => {
      cancelled = true;
      docRef.current?.destroy();
      docRef.current = null;
    };
  }, [url]);

  // Render the current page whenever the page number, zoom, or document changes.
  useEffect(() => {
    if (status !== "ready" || !docRef.current || !canvasRef.current) return;
    let cancelled = false;
    (async () => {
      const pdf = docRef.current!;
      const pdfPage = await pdf.getPage(page);
      if (cancelled) return;
      const viewport = pdfPage.getViewport({ scale });
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      // Render at the screen's real pixel density (devicePixelRatio), not 1 CSS pixel = 1 canvas pixel — otherwise
      // the page looks soft/blurry on any HiDPI (Retina, 125%+ Windows scaling) display, which is most of them.
      const outputScale = window.devicePixelRatio || 1;
      canvas.width = Math.floor(viewport.width * outputScale);
      canvas.height = Math.floor(viewport.height * outputScale);
      canvas.style.width = `${Math.floor(viewport.width)}px`;
      canvas.style.height = `${Math.floor(viewport.height)}px`;
      renderTaskRef.current?.cancel();
      const transform = outputScale !== 1 ? [outputScale, 0, 0, outputScale, 0, 0] : undefined;
      const task = pdfPage.render({ canvasContext: ctx, viewport, transform });
      renderTaskRef.current = task;
      try {
        await task.promise;
      } catch {
        // Cancelled renders (page/zoom changed mid-render) throw; nothing to show for those.
      }
    })();
    return () => { cancelled = true; };
  }, [status, page, scale]);

  const toolbar = status === "ready" ? (
    <>
      <button type="button" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1}>‹ Prev</button>
      <span className="name">Page {page} of {numPages}</span>
      <button type="button" onClick={() => setPage((p) => Math.min(numPages, p + 1))} disabled={page >= numPages}>Next ›</button>
      <button type="button" onClick={() => setScale((s) => Math.max(MIN_SCALE, s - 0.15))} disabled={scale <= MIN_SCALE}>−</button>
      <button type="button" onClick={() => setScale((s) => Math.min(MAX_SCALE, s + 0.15))} disabled={scale >= MAX_SCALE}>+</button>
    </>
  ) : undefined;

  return (
    <Shell filename={filename} toolbar={toolbar} newTabHref={newTabHref}>
      {status === "loading" && <p className="doc-preview-status">Loading…</p>}
      {status === "error" && <p className="doc-preview-status">{errorMsg}</p>}
      <canvas ref={canvasRef} style={{ display: status === "ready" ? "block" : "none", background: "#fff", boxShadow: "0 2px 12px rgba(0,0,0,.4)" }} />
    </Shell>
  );
}
