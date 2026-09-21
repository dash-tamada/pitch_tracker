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

export function LoginForm({ initialStep }: { initialStep: "password" | "mfa" }) {
  const [step, setStep] = useState(initialStep);
  const [error, setError] = useState<string | null>(null);
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
        {step === "password" && <p className="subtle"><a href="/forgot-password">Forgot password?</a></p>}
      </form>
    </Clapboard>
  );
}
