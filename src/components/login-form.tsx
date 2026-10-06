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

type Step = "password" | "mfa" | "wa-mobile" | "wa-code" | "wa-choose" | "social";
interface AccountChoice { userId: string; company: string; name: string; email: string }
interface SessionReply { mustChangePassword?: boolean; mfaEnrolmentRequired?: boolean; mfaRequired?: boolean; choose?: AccountChoice[]; choiceToken?: string }

const TITLES: Record<Step, string> = {
  password: "Sign in", mfa: "Two-factor verification", "wa-mobile": "Sign in with WhatsApp", "wa-code": "Enter your code", "wa-choose": "Choose an account", social: "Sign in",
};

export function LoginForm({ initialStep, google = false, whatsapp = false, urlError }: { initialStep: "password" | "mfa" | "wa-mobile" | "social"; google?: boolean; whatsapp?: boolean; urlError?: string }) {
  const [step, setStep] = useState<Step>(initialStep);
  const [error, setError] = useState<string | null>(urlError ? URL_ERRORS[urlError] ?? null : null);
  const [busy, setBusy] = useState(false);
  const [mobile, setMobile] = useState("");
  const [accounts, setAccounts] = useState<AccountChoice[]>([]);
  const [choiceToken, setChoiceToken] = useState("");
  const { clapping, clapThen } = useClap();

  function go(next: Step) { setError(null); setStep(next); }

  /** A reply that created a session: follow the same gates as a password sign-in. */
  function afterSession(r: SessionReply): boolean {
    // A temp password set by the platform must be replaced before MFA set-up or anything else.
    if (r.mustChangePassword) { window.location.assign("/change-password"); return true; }
    if (r.mfaEnrolmentRequired) { window.location.assign("/mfa-setup"); return true; }
    // Another take to go — the board only claps once the whole sign-in is done.
    if (r.mfaRequired) { setStep("mfa"); setBusy(false); return true; }
    return false;
  }

  async function chooseAccount(userId: string) {
    setError(null); setBusy(true);
    try {
      const r: SessionReply = await post("/api/v1/auth/otp/choose", { choiceToken, userId });
      if (afterSession(r)) return;
      clapThen("/dashboard");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
      setBusy(false);
    }
  }

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const form = new FormData(e.currentTarget);
    try {
      if (step === "password") {
        const r: SessionReply = await post("/api/v1/auth/login", { email: form.get("email"), password: form.get("password") });
        if (afterSession(r)) return;
      } else if (step === "wa-mobile") {
        const m = String(form.get("mobile") ?? "");
        await post("/api/v1/auth/otp/request", { mobile: m });
        setMobile(m); setStep("wa-code"); setBusy(false); return;
      } else if (step === "wa-code") {
        const r: SessionReply = await post("/api/v1/auth/otp/verify", { mobile, code: form.get("code") });
        if (r.choose && r.choiceToken) { setAccounts(r.choose); setChoiceToken(r.choiceToken); setStep("wa-choose"); setBusy(false); return; }
        if (afterSession(r)) return;
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
      scene={step === "password" ? undefined : step === "mfa" ? "Second take" : "WhatsApp"}
      title={TITLES[step]}
    >
      <form onSubmit={onSubmit} noValidate>
        {error && <p className="error" role="alert">{error}</p>}
        {step === "password" && (
          <>
            <label className="field">Work email<input name="email" type="email" autoComplete="username" required /></label>
            <label className="field">Password<input name="password" type="password" autoComplete="current-password" required /></label>
          </>
        )}
        {step === "mfa" && (
          <label className="field">6-digit code from your authenticator app
            <input name="code" inputMode="numeric" autoComplete="one-time-code" pattern="\d{6}" maxLength={6} required />
          </label>
        )}
        {step === "wa-mobile" && (
          <label className="field">Mobile number
            <input name="mobile" type="tel" inputMode="tel" autoComplete="tel" placeholder="+91 98765 43210" maxLength={24} required />
          </label>
        )}
        {step === "wa-code" && (
          <label className="field">6-digit code sent to {mobile} on WhatsApp
            <input name="code" inputMode="numeric" autoComplete="one-time-code" pattern="\d{6}" maxLength={6} required />
          </label>
        )}
        {step === "wa-choose" ? (
          <>
            <p className="subtle">This number is linked to more than one account. Which one do you want to sign in to?</p>
            <ul className="acct-list">
              {accounts.map((a) => (
                <li key={a.userId}>
                  <button type="button" className="acct-btn" disabled={busy} onClick={() => chooseAccount(a.userId)}>
                    <span className="acct-co">{a.company}</span>
                    <span className="acct-name">{a.name}</span>
                    <span className="acct-mail">{a.email}</span>
                  </button>
                </li>
              ))}
            </ul>
          </>
        ) : step === "social" ? null : (
          <button className="btn" disabled={busy}>{busy ? "Rolling…" : step === "wa-mobile" ? "Send code" : "Action"}</button>
        )}
        {(step === "wa-mobile" || step === "social") && google && (
          <>
            {step === "wa-mobile" && <p className="or-rule"><span>or</span></p>}
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
        {step === "social" && !google && <p className="subtle">Sign-in is being set up. Please contact your administrator.</p>}
        {step === "wa-code" && <p className="subtle"><button type="button" className="link-btn" onClick={() => go("wa-mobile")}>Use a different number</button></p>}
        {step === "wa-choose" && <p className="subtle"><button type="button" className="link-btn" onClick={() => go("wa-mobile")}>Start again</button></p>}
        {(step === "wa-mobile" || step === "social") && <p className="subtle"><a href="/login?admin=1">Platform administrator? Sign in with email</a></p>}
        {step === "password" && (
          <p className="subtle"><a href="/forgot-password">Forgot password?</a> · <a href="/login">Back to sign in with mobile or Google</a></p>
        )}
      </form>
    </Clapboard>
  );
}
