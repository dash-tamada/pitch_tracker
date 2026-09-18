"use client";

import { useState, type FormEvent } from "react";
import { api, ApiError } from "./client-api";

type Opt = { key: string; label: string };
type Link = { label: string; url: string };
const ROLES: Opt[] = [["WRITER", "Writer"], ["DIRECTOR", "Director"], ["WRITER_DIRECTOR", "Writer + Director"], ["PRODUCER", "Producer"], ["CREATOR", "Creator"], ["OTHER", "Other"]].map(([key, label]) => ({ key: key!, label: label! }));

export interface PortalProfileInitial {
  creatorType: string; fullName: string; mobile: string | null; email: string | null; location: string | null;
  languageKeys: string[]; yearsExperience: number | null; bio: string | null; agency: string | null;
  previousCompanies: string[]; website: string | null; socialLinks: Link[]; profileCompleted: boolean;
}

/**
 * Portal counterpart to staff's CreatorForm (creator-form.tsx) for the fields Images 2 & 3 show — minus
 * Consent/legal basis and Internal notes, which are staff-only (Postgres itself refuses those columns for
 * pitch_creator; see profile.ts's file comment) — plus an IMDB/Wikipedia/other-links section (socialLinks).
 * The very first successful save is what completes the profile (see profile.ts), so it redirects to the
 * pitch dashboard that save just unlocked; every save after that is an ordinary edit that stays on the page.
 */
export function PortalProfileForm({ token, languages, initial }: { token: string; languages: Opt[]; initial: PortalProfileInitial }) {
  const firstTime = !initial.profileCompleted;
  const [links, setLinks] = useState<Link[]>(initial.socialLinks);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null); setFields({}); setSaved(false); setBusy(true);
    const f = new FormData(e.currentTarget);
    const str = (k: string) => String(f.get(k) ?? "").trim();
    const years = str("yearsExperience");
    const body: Record<string, unknown> = {
      creatorType: str("creatorType"), fullName: str("fullName"), mobile: str("mobile"), email: str("email"),
      location: str("location"), bio: str("bio"), agency: str("agency"), website: str("website"),
      languageKeys: f.getAll("languageKeys").map(String),
      previousCompanies: str("previousCompanies").split(",").map((s) => s.trim()).filter(Boolean),
      socialLinks: links.filter((l) => l.label.trim() && l.url.trim()),
      ...(years ? { yearsExperience: Number(years) } : {}),
    };
    try {
      await api("PATCH", `/api/v1/portal/${token}/profile`, body);
      if (firstTime) window.location.assign(`/portal/${token}/pitches`);
      else setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      if (err instanceof ApiError && err.fields) setFields(err.fields);
    } finally { setBusy(false); }
  }

  const setLink = (i: number, k: keyof Link, v: string) => setLinks((ls) => ls.map((l, j) => (j === i ? { ...l, [k]: v } : l)));
  const fe = (k: string) => (fields[k] ? <span className="field-error">{fields[k]}</span> : null);

  return (
    <form onSubmit={submit} noValidate>
      {error && <p className="error" role="alert">{error}</p>}
      {saved && <p className="subtle">Profile saved.</p>}
      <div className="section">
        <h2>Basic profile</h2>
        <div className="form-grid">
          <label className="field">Full name *<input name="fullName" required minLength={2} maxLength={120} defaultValue={initial.fullName} />{fe("fullName")}</label>
          <label className="field">Professional role *<select name="creatorType" defaultValue={initial.creatorType}>{ROLES.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}</select></label>
          <label className="field">Mobile number<input name="mobile" inputMode="tel" maxLength={20} defaultValue={initial.mobile ?? ""} />{fe("mobile")}</label>
          <label className="field">Email *<input name="email" type="email" required maxLength={254} defaultValue={initial.email ?? ""} />{fe("email")}</label>
          <label className="field">Location<input name="location" defaultValue={initial.location ?? ""} /></label>
          <label className="field">Years of experience<input name="yearsExperience" type="number" min={0} max={80} defaultValue={initial.yearsExperience ?? ""} />{fe("yearsExperience")}</label>
          <fieldset className="field full"><legend>Languages</legend>
            <div className="chips">{languages.map((l) => (
              <label key={l.key} className="chip"><input type="checkbox" name="languageKeys" value={l.key} defaultChecked={initial.languageKeys.includes(l.key)} /> {l.label}</label>
            ))}</div>
          </fieldset>
          <label className="field full">Professional bio<textarea name="bio" defaultValue={initial.bio ?? ""} /></label>
        </div>
      </div>
      <div className="section">
        <h2>Career</h2>
        <div className="form-grid">
          <label className="field">Agency / representation<input name="agency" defaultValue={initial.agency ?? ""} /></label>
          <label className="field">Website<input name="website" type="url" placeholder="https://" defaultValue={initial.website ?? ""} />{fe("website")}</label>
          <label className="field full">Previous production companies<input name="previousCompanies" placeholder="Comma separated" defaultValue={initial.previousCompanies.join(", ")} /></label>
        </div>
      </div>
      <div className="section">
        <h2>IMDB, Wikipedia &amp; other links</h2>
        <p className="subtle">Add a link to your IMDB page, Wikipedia page, or anywhere else people can read about your work.</p>
        {links.map((l, i) => (
          <div key={i} className="form-grid">
            <label className="field">Label<input placeholder="IMDB, Wikipedia…" value={l.label} maxLength={40} onChange={(e) => setLink(i, "label", e.target.value)} /></label>
            <label className="field">URL<input type="url" placeholder="https://" value={l.url} onChange={(e) => setLink(i, "url", e.target.value)} /></label>
            <div className="full"><button type="button" className="btn-secondary" onClick={() => setLinks((ls) => ls.filter((_, j) => j !== i))}>Remove</button></div>
          </div>
        ))}
        <button type="button" className="btn-secondary" onClick={() => setLinks((ls) => [...ls, { label: "", url: "" }])}>+ Add link</button>
      </div>
      <div className="row-actions"><button className="btn-inline" disabled={busy}>{busy ? "Saving…" : firstTime ? "Save & continue" : "Save changes"}</button></div>
    </form>
  );
}
