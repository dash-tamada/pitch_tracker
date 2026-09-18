"use client";

import { useState, type FormEvent } from "react";
import { api, ApiError } from "./client-api";

/** A creator can change their password any time from "My profile" — there is no email-based reset flow yet. */
export function PortalPasswordForm({ token }: { token: string }) {
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null); setFields({}); setSaved(false); setBusy(true);
    const form = e.currentTarget;
    const f = new FormData(form);
    try {
      await api("POST", `/api/v1/portal/${token}/profile/password`, {
        currentPassword: String(f.get("currentPassword") ?? ""),
        newPassword: String(f.get("newPassword") ?? ""),
      });
      setSaved(true);
      form.reset();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      if (err instanceof ApiError && err.fields) setFields(err.fields);
    } finally { setBusy(false); }
  }
  const fe = (k: string) => (fields[k] ? <span className="field-error">{fields[k]}</span> : null);

  return (
    <form className="section" onSubmit={submit} noValidate>
      <h2>Change password</h2>
      {error && <p className="error" role="alert">{error}</p>}
      {saved && <p className="subtle">Password changed. You&apos;ve been signed out on any other device.</p>}
      <div className="form-grid">
        <label className="field">Current password<input name="currentPassword" type="password" required autoComplete="current-password" />{fe("currentPassword")}</label>
        <label className="field">New password<input name="newPassword" type="password" required autoComplete="new-password" />{fe("newPassword")}</label>
      </div>
      <div className="row-actions"><button className="btn-secondary" disabled={busy}>{busy ? "Saving…" : "Change password"}</button></div>
    </form>
  );
}
