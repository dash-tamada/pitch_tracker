"use client";

import { useState, type FormEvent } from "react";
import { Clapboard } from "./clapboard";
import { api } from "./client-api";

type Step = "mobile" | "code" | "profile";
const TYPES: [string, string][] = [["WRITER", "Writer"], ["DIRECTOR", "Director"], ["WRITER_DIRECTOR", "Writer-Director"], ["PRODUCER", "Producer"], ["CREATOR", "Creator"], ["OTHER", "Other"]];

/** Register or sign in with a mobile number and a WhatsApp code. A new number is asked for a name and role after the code. */
export function CreatorAuth() {
  const [step, setStep] = useState<Step>("mobile");
  const [mobile, setMobile] = useState("");
  const [profileToken, setProfileToken] = useState("");
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
        const r = await api<{ signedIn?: boolean; needsProfile?: boolean; profileToken?: string }>("POST", "/api/v1/creator/otp/verify", { mobile, code: String(f.get("code") ?? "") });
        if (r.needsProfile && r.profileToken) { setProfileToken(r.profileToken); setStep("profile"); setBusy(false); return; }
      } else {
        await api("POST", "/api/v1/creator/register", { mobile, profileToken, fullName: String(f.get("fullName") ?? ""), creatorType: String(f.get("creatorType") ?? "") });
      }
      window.location.assign("/creator");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
      setBusy(false);
    }
  }

  const title = step === "mobile" ? "Pitch your story" : step === "code" ? "Enter your code" : "Tell us about you";
  return (
    <Clapboard title={title} scene="Writers & directors">
      <form onSubmit={submit} noValidate>
        {error && <p className="error" role="alert">{error}</p>}
        {step === "mobile" && (
          <>
            <p className="subtle">Register or sign in with your mobile number. We send a code on WhatsApp, no password needed.</p>
            <label className="field">Mobile number<input name="mobile" type="tel" inputMode="tel" autoComplete="tel" placeholder="+91 98765 43210" maxLength={24} required /></label>
          </>
        )}
        {step === "code" && (
          <label className="field">6-digit code sent to {mobile} on WhatsApp
            <input name="code" inputMode="numeric" autoComplete="one-time-code" pattern="\d{6}" maxLength={6} required />
          </label>
        )}
        {step === "profile" && (
          <>
            <label className="field">Your name<input name="fullName" autoComplete="name" maxLength={120} required /></label>
            <label className="field">You are a<select name="creatorType" required defaultValue="WRITER">{TYPES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
          </>
        )}
        <button className="btn" disabled={busy}>{busy ? "Rolling…" : step === "mobile" ? "Send code" : step === "code" ? "Verify" : "Create my account"}</button>
        {step === "code" && <p className="subtle"><button type="button" className="link-btn" onClick={() => { setError(null); setStep("mobile"); }}>Use a different number</button></p>}
        <p className="subtle"><a href="/login">Company staff sign in</a></p>
      </form>
    </Clapboard>
  );
}
