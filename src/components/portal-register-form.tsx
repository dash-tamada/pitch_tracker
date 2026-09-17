"use client";

import { useState, type FormEvent } from "react";
import { api, ApiError } from "./client-api";

type Opt = { key: string; label: string };

export function PortalRegisterForm({ token, creatorTypes }: { token: string; creatorTypes: Opt[] }) {
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null); setFields({}); setBusy(true);
    const f = new FormData(e.currentTarget);
    try {
      await api("POST", `/api/v1/portal/${token}/register`, {
        creatorType: String(f.get("creatorType") ?? ""),
        fullName: String(f.get("fullName") ?? "").trim(),
        mobile: String(f.get("mobile") ?? "").trim() || undefined,
        email: String(f.get("email") ?? "").trim(),
        password: String(f.get("password") ?? ""),
      });
      window.location.assign(`/portal/${token}/pitches`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
      if (err instanceof ApiError && err.fields) setFields(err.fields);
      setBusy(false);
    }
  }
  const fe = (k: string) => (fields[k] ? <span className="field-error">{fields[k]}</span> : null);

  return (
    <form onSubmit={onSubmit} noValidate>
      <h1>Create your account</h1>
      {error && <p className="error" role="alert">{error}</p>}
      <label className="field">You are a *
        <select name="creatorType" required defaultValue="">
          <option value="" disabled>Choose…</option>
          {creatorTypes.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
        </select>
      </label>
      <label className="field">Full name *<input name="fullName" required minLength={2} maxLength={120} autoComplete="name" />{fe("fullName")}</label>
      <label className="field">Mobile number<input name="mobile" maxLength={20} autoComplete="tel" />{fe("mobile")}</label>
      <label className="field">Email *<input name="email" type="email" required maxLength={254} autoComplete="username" />{fe("email")}</label>
      <label className="field">Password *<input name="password" type="password" required autoComplete="new-password" />{fe("password")}</label>
      <button className="btn" disabled={busy}>{busy ? "Please wait…" : "Register"}</button>
      <p className="subtle">Already registered? <a href={`/portal/${token}/login`}>Sign in</a></p>
    </form>
  );
}
