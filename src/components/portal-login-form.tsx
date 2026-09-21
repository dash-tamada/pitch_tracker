"use client";

import { useState, type FormEvent } from "react";
import { api } from "./client-api";
import { Clapboard, useClap } from "./clapboard";

export function PortalLoginForm({ token }: { token: string }) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { clapping, clapThen } = useClap();

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null); setBusy(true);
    const f = new FormData(e.currentTarget);
    try {
      await api("POST", `/api/v1/portal/${token}/login`, { email: String(f.get("email") ?? "").trim(), password: String(f.get("password") ?? "") });
      clapThen(`/portal/${token}/pitches`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
      setBusy(false);
    }
  }

  return (
    <Clapboard clapping={clapping} scene="Creator portal" title="Sign in">
      <form onSubmit={onSubmit} noValidate>
        {error && <p className="error" role="alert">{error}</p>}
        <label className="field">Email<input name="email" type="email" required autoComplete="username" /></label>
        <label className="field">Password<input name="password" type="password" required autoComplete="current-password" /></label>
        <button className="btn" disabled={busy}>{busy ? "Rolling…" : "Action"}</button>
        <p className="subtle">New here? <a href={`/portal/${token}/register`}>Register</a></p>
      </form>
    </Clapboard>
  );
}
