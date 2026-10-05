"use client";

import { useState, type FormEvent } from "react";
import { Clapboard, useClap } from "./clapboard";

function csrfToken(): string {
  const name = document.cookie.includes("__Host-pt_csrf=") ? "__Host-pt_csrf" : "pt_csrf";
  return document.cookie.split("; ").find((c) => c.startsWith(`${name}=`))?.split("=")[1] ?? "";
}

async function post(url: string, body: unknown) {
  const res = await fetch(url, {
    method: "POST", credentials: "same-origin",
    headers: { "content-type": "application/json", "x-csrf-token": csrfToken() },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error?.message ?? "Something went wrong. Please try again.");
  return data;
}

const URL_ERRORS: Record<string, string> = {
  google_denied: "That Google account is not registered for Pitch Tracker. Ask your administrator to invite you.",
  google_failed: "Google sign-in did not complete. Please try again.",
  google_off: "Sign in with Google is not set up yet.",
};

export function LoginForm({ initialStep, google = false, urlError }: { initialStep: "password" | "mfa"; google?: boolean; urlError?: string }) {
  const [step, setStep] = useState(initialStep);
  const [error, setError] = useState<string | null>(urlError ? URL_ERRORS[urlError] ?? null : null);
  const [busy, setBusy] = useState(false);
  const { clapping, clapThen } = useClap();

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const form = new FormData(e.currentTarget);
    try {
      if (step === "password") {
        const r = await post("/api/v1/auth/login", { email: form.get("email"), password: form.get("password") });
        // A temp password set by the platform must be replaced before MFA set-up or anything else.
        if (r.mustChangePassword) { window.location.assign("/change-password"); return; }
        if (r.mfaEnrolmentRequired) { window.location.assign("/mfa-setup"); return; }
        // Another take to go — the board only claps once the whole sign-in is done.
        if (r.mfaRequired) { setStep("mfa"); setBusy(false); return; }
      } else {
        await post("/api/v1/auth/mfa/verify", { code: form.get("code") });
      }
      clapThen("/dashboard"); // fixed internal path — no open redirect
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
      setBusy(false);
    }
  }

  return (
    <Clapboard
      clapping={clapping}
      scene={step === "password" ? undefined : "Second take"}
      title={step === "password" ? "Sign in" : "Two-factor verification"}
    >
      <form onSubmit={onSubmit} noValidate>
        {error && <p className="error" role="alert">{error}</p>}
        {step === "password" ? (
          <>
            <label className="field">Work email<input name="email" type="email" autoComplete="username" required /></label>
            <label className="field">Password<input name="password" type="password" autoComplete="current-password" required /></label>
          </>
        ) : (
          <label className="field">6-digit code from your authenticator app
            <input name="code" inputMode="numeric" autoComplete="one-time-code" pattern="\d{6}" maxLength={6} required />
          </label>
        )}
        <button className="btn" disabled={busy}>{busy ? "Rolling…" : "Action"}</button>
        {step === "password" && google && (
          <>
            <p className="or-rule"><span>or</span></p>
            <a className="google-btn" href="/api/v1/auth/google/start">
              <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
                <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.9 6.1C12.4 13.6 17.7 9.5 24 9.5z" />
                <path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.5 5.8c4.4-4.1 7.1-10.1 7.1-17.5z" />
                <path fill="#FBBC05" d="M10.5 28.7c-.5-1.5-.8-3-.8-4.7s.3-3.2.8-4.7l-7.9-6.1C.9 16.4 0 20.1 0 24s.9 7.6 2.6 10.8l7.9-6.1z" />
                <path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.5-5.8c-2.1 1.4-4.9 2.3-8.4 2.3-6.3 0-11.6-4.1-13.5-9.8l-7.9 6.1C6.5 42.6 14.6 48 24 48z" />
              </svg>
              Sign in with Google
            </a>
          </>
        )}
        {step === "password" && <p className="subtle"><a href="/forgot-password">Forgot password?</a></p>}
      </form>
    </Clapboard>
  );
}
