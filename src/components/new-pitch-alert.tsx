"use client";

import { useState } from "react";
import { api } from "./client-api";

interface Incoming { id: string; code: string; title: string; creator: string }

/**
 * The "new pitch received" pop-up, like an email arriving. It is drawn on every staff page until someone in the company
 * acknowledges it — the acknowledgement is stored for the whole company, so the first click clears it for everyone.
 */
export function NewPitchAlert({ items }: { items: Incoming[] }) {
  const [open, setOpen] = useState(true);
  const [busy, setBusy] = useState(false);
  if (!open || items.length === 0) return null;
  const shown = items.slice(0, 4);

  async function ack(then?: string) {
    setBusy(true);
    try { await api("POST", "/api/v1/pitches/intake/ack", { ids: items.map((i) => i.id) }); } catch { /* it simply shows again next time */ }
    setOpen(false);
    if (then) window.location.assign(then);
  }

  return (
    <div className="intake-alert" role="alertdialog" aria-labelledby="intake-h" aria-live="assertive">
      <div className="intake-head">
        <span className="intake-ico" aria-hidden="true">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m3 7 9 6 9-6" /></svg>
        </span>
        <div>
          <strong id="intake-h">{items.length === 1 ? "New pitch received" : `${items.length} new pitches received`}</strong>
          <span className="muted">Sent to your production house</span>
        </div>
      </div>
      <ul className="intake-list">
        {shown.map((i) => (
          <li key={i.id}><button type="button" className="intake-item" disabled={busy} onClick={() => ack(`/pitches/${i.id}`)}>
            <span className="intake-title">{i.title}</span><span className="muted">{i.creator} · {i.code}</span></button></li>
        ))}
      </ul>
      {items.length > shown.length && <p className="muted intake-more">+ {items.length - shown.length} more</p>}
      <div className="intake-actions">
        <button type="button" className="btn-inline" disabled={busy} onClick={() => ack()}>Mark as seen</button>
        <button type="button" className="btn-secondary" disabled={busy} onClick={() => ack("/pitches")}>Open pitches</button>
      </div>
    </div>
  );
}
