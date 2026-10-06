"use client";

import { useState, type FormEvent } from "react";
import { api } from "./client-api";

/** Lets a person add, change or clear their own WhatsApp number on the account page. */
export function WhatsappForm({ current }: { current: string | null }) {
  const [saved, setSaved] = useState(current);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null); setNote(null); setBusy(true);
    try {
      const f = new FormData(e.currentTarget);
      const r = await api<{ mobileE164: string | null }>("PATCH", "/api/v1/account/whatsapp", { mobile: String(f.get("mobile") ?? "") });
      setSaved(r.mobileE164);
      setNote(r.mobileE164 ? "WhatsApp number saved." : "WhatsApp number removed.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
    } finally { setBusy(false); }
  }

  return (
    <div className="section">
      <h2>WhatsApp number</h2>
      <p className="subtle">Used to reach you about stories that need your attention. Add the number with country code, or 10 digits for India.</p>
      <form onSubmit={submit} noValidate>
        {error && <p className="error" role="alert">{error}</p>}
        {note && <p className="success" role="status">{note}</p>}
        <label className="field">WhatsApp number
          <input name="mobile" type="tel" inputMode="tel" autoComplete="tel" maxLength={24} defaultValue={saved ?? ""} placeholder="+91 98765 43210" />
        </label>
        <div className="row-actions">
          <button className="btn" disabled={busy}>{busy ? "Saving…" : saved ? "Update number" : "Save number"}</button>
        </div>
      </form>
    </div>
  );
}
