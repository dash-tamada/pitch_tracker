"use client";

import { useState, type FormEvent } from "react";
import { Clapboard } from "./clapboard";
import { api } from "./client-api";
import { EMPTY_DETAILS, ProfileFields, toPayload, type DetailsState } from "./profile-fields";

type Step = "mobile" | "code" | "details";

/**
 * Writer / director sign-up — the only writer-specific entry. Signing in afterwards is on the shared login page. Three steps:
 * a mobile number, the WhatsApp code that proves it, then the profile (experience, projects and credits, links). The profile
 * photo, which is required, is added on the very next screen.
 */
export function CreatorSignup() {
  const [step, setStep] = useState<Step>("mobile");
  const [mobile, setMobile] = useState("");
  const [profileToken, setProfileToken] = useState("");
  const [details, setDetails] = useState<DetailsState>(EMPTY_DETAILS);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null); setBusy(true);
    const f = new FormData(e.currentTarget);
    try {
      if (step === "mobile") {
        const m = String(f.get("mobile") ?? "");
        await api("POST", "/api/v1/creator/otp/request", { mobile: m });
        setMobile(m); setStep("code"); setBusy(false); return;
      }
      if (step === "code") {
        const r = await api<{ profileToken: string }>("POST", "/api/v1/creator/otp/verify", { mobile, code: String(f.get("code") ?? "") });
        setProfileToken(r.profileToken); setStep("details"); setBusy(false); return;
      }
      await api("POST", "/api/v1/creator/register", { mobile, profileToken, ...toPayload(details) });
      window.location.assign("/creator/profile?complete=1"); // the photo comes next
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
      setBusy(false);
    }
  }

  if (step === "details") {
    return (
      <form className="signup-sheet" onSubmit={submit} noValidate>
        <p className="signup-eyebrow">Step 3 of 3</p>
        <h1 className="signup-title">Tell us about your work</h1>
        <p className="subtle">Production houses see this when you pitch to them. You can change any of it later from your profile.</p>
        {error && <p className="error" role="alert">{error}</p>}
        <ProfileFields value={details} onChange={setDetails} />
        <div className="row-actions"><button className="btn-inline" disabled={busy}>{busy ? "Creating your studio…" : "Create my studio"}</button></div>
        <p className="subtle">Next you will add your profile photo — it is required before the studio opens.</p>
      </form>
    );
  }

  const title = step === "mobile" ? "Sign up to pitch" : "Enter your code";
  return (
    <Clapboard title={title} scene="Writers & directors">
      <form onSubmit={submit} noValidate>
        {error && <p className="error" role="alert">{error}</p>}
        {step === "mobile" && (
          <>
            <p className="subtle">Create your Creator Studio with your mobile number. We send a code on WhatsApp — no password needed.</p>
            <label className="field">Mobile number<input name="mobile" type="tel" inputMode="tel" autoComplete="tel" placeholder="+91 98765 43210" maxLength={24} required /></label>
          </>
        )}
        {step === "code" && (
          <label className="field">6-digit code sent to {mobile} on WhatsApp
            <input name="code" inputMode="numeric" autoComplete="one-time-code" pattern="\d{6}" maxLength={6} required />
          </label>
        )}
        <button className="btn" disabled={busy}>{busy ? "Rolling…" : step === "mobile" ? "Send code" : "Verify"}</button>
        {step === "code" && <p className="subtle"><button type="button" className="link-btn" onClick={() => { setError(null); setStep("mobile"); }}>Use a different number</button></p>}
        <p className="subtle">Already have an account? <a href="/login">Sign in</a></p>
      </form>
    </Clapboard>
  );
}
