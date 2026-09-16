"use client";

import { useEffect, useState, type FormEvent } from "react";
import { api } from "./client-api";

export function SetPasswordForm({ endpoint = "/api/v1/auth/password/reset", heading = "Set your password", sessionAuth = false }: {
  endpoint?: string; heading?: string;
  /** true: the caller already holds a valid session cookie (no `/set-password#token` link); no fragment token is read or sent,
   *  and success goes straight to /dashboard (which redirects on to MFA set-up if that is still needed). */
  sessionAuth?: boolean;
} = {}) {
  const [token, setToken] = useState<string | null>(sessionAuth ? "" : null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  useEffect(() => {
    if (sessionAuth) return;
    // The token is in the URL fragment, which browsers never send to servers or in Referer headers.
    const t = window.location.hash.slice(1);
    setToken(/^[A-Za-z0-9_-]{20,128}$/.test(t) ? t : "");
    history.replaceState(null, "", window.location.pathname);
  }, [sessionAuth]);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    if (f.get("password") !== f.get("confirm")) { setError("Passwords do not match."); return; }
    try {
      await api("POST", endpoint, sessionAuth ? { password: f.get("password") } : { token, password: f.get("password") });
      if (sessionAuth) { window.location.assign("/dashboard"); return; }
      setDone(true);
    } catch (err) { setError(err instanceof Error ? err.message : "Failed"); }
  }
  if (token === null) return null;
  if (!sessionAuth && !token) return <form><h1>Link not valid</h1><p>Ask your Company Admin for a new link.</p></form>;
  if (done) return <form><h1>Password set</h1><p><a href="/login">Sign in</a></p></form>;
  return (
    <form onSubmit={submit}>
      <h1>{heading}</h1>
      {error && <p className="error" role="alert">{error}</p>}
      <p className="subtle">At least 6 characters. Mix upper and lower case, numbers or symbols — or use 16+ characters.</p>
      <label className="field">New password<input name="password" type="password" autoComplete="new-password" required minLength={6} maxLength={128} /></label>
      <label className="field">Confirm password<input name="confirm" type="password" autoComplete="new-password" required /></label>
      <button className="btn">Set password</button>
    </form>
  );
}

export function ForgotPasswordForm() {
  const [sent, setSent] = useState(false);
  return sent ? <form><h1>Check your email</h1><p>If that address has an account, a reset link is on its way. It expires in 30 minutes.</p></form> : (
    <form onSubmit={async (e) => { e.preventDefault(); const f = new FormData(e.currentTarget); try { await api("POST", "/api/v1/auth/password/forgot", { email: f.get("email") }); } finally { setSent(true); } }}>
      <h1>Reset password</h1>
      <label className="field">Work email<input name="email" type="email" required autoComplete="username" /></label>
      <button className="btn">Send reset link</button>
    </form>
  );
}

export function MfaEnrol({ enabled }: { enabled: boolean }) {
  const [uri, setUri] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(enabled);
  if (done) return <p className="success">Two-factor authentication is on.</p>;
  const secret = uri ? new URL(uri).searchParams.get("secret") : null;
  return (
    <div className="section">
      <h2>Two-factor authentication</h2>
      {error && <p className="error">{error}</p>}
      {!uri ? <button className="btn-inline" onClick={async () => { try { setUri((await api<{ otpauthUri: string }>("POST", "/api/v1/auth/mfa/enroll")).otpauthUri); } catch (e) { setError(e instanceof Error ? e.message : "Failed"); } }}>Set up authenticator app</button> : (
        <form onSubmit={async (e) => { e.preventDefault(); const f = new FormData(e.currentTarget);
          try { await api("POST", "/api/v1/auth/mfa/confirm", { code: f.get("code") }); setDone(true); window.location.assign("/dashboard"); } catch (err) { setError(err instanceof Error ? err.message : "Failed"); } }}>
          <p>In Google Authenticator, Microsoft Authenticator or 1Password choose “Enter a setup key” and type:</p>
          <p><code className="secret">{secret?.match(/.{1,4}/g)?.join(" ")}</code></p>
          <p className="subtle">Account: Pitch Tracker · Type: time-based. Do not share this key.</p>
          <label className="field">6-digit code<input name="code" inputMode="numeric" pattern="\d{6}" maxLength={6} required autoComplete="one-time-code" /></label>
          <button className="btn-inline">Confirm</button>
        </form>
      )}
    </div>
  );
}
