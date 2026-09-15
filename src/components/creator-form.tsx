"use client";

import { useState, type FormEvent } from "react";
import { api, ApiError } from "./client-api";

type Opt = { key: string; label: string };
type Project = { projectName: string; role: string; productionCompany: string; platformName: string; releaseYear: string; languageKey: string; genreKey: string; projectStatus: string; description: string; link: string };
const emptyProject = (): Project => ({ projectName: "", role: "WRITER", productionCompany: "", platformName: "", releaseYear: "", languageKey: "", genreKey: "", projectStatus: "", description: "", link: "" });
const ROLES: Opt[] = [["WRITER", "Writer"], ["DIRECTOR", "Director"], ["WRITER_DIRECTOR", "Writer + Director"], ["PRODUCER", "Producer"], ["CREATOR", "Creator"], ["OTHER", "Other"]].map(([key, label]) => ({ key: key!, label: label! }));

export interface CreatorInitial {
  id?: string; creatorType?: string; fullName?: string; mobile?: string | null; email?: string | null; location?: string | null;
  languageKeys?: string[]; yearsExperience?: number | null; bio?: string | null; agency?: string | null; previousCompanies?: string[];
  website?: string | null; notes?: string | null; consentBasis?: string | null; piiMasked?: boolean;
}

export function CreatorForm({ languages, genres, initial }: { languages: Opt[]; genres: Opt[]; initial?: CreatorInitial }) {
  const editing = Boolean(initial?.id);
  const [step, setStep] = useState<"check" | "form">(editing ? "form" : "check");
  const [matches, setMatches] = useState<{ id: string; fullName: string; creatorType: string; mobile: string | null; matchedOn: string[] }[] | null>(null);
  const [check, setCheck] = useState({ name: "", mobile: "", email: "" });
  const [projects, setProjects] = useState<Project[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  async function runCheck(e: FormEvent) {
    e.preventDefault();
    setError(null); setBusy(true);
    try {
      const r = await api<{ matches: NonNullable<typeof matches> }>("POST", "/api/v1/creators/match", check);
      setMatches(r.matches);
      if (r.matches.length === 0) setStep("form");
    } catch (err) { setError(err instanceof Error ? err.message : "Something went wrong."); }
    finally { setBusy(false); }
  }

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null); setFields({}); setBusy(true);
    const f = new FormData(e.currentTarget);
    const str = (k: string) => String(f.get(k) ?? "").trim();
    const body: Record<string, unknown> = {
      creatorType: str("creatorType"), fullName: str("fullName"), location: str("location"), bio: str("bio"), agency: str("agency"),
      website: str("website"), notes: str("notes"), consentBasis: str("consentBasis"),
      languageKeys: f.getAll("languageKeys").map(String),
      previousCompanies: str("previousCompanies").split(",").map((s) => s.trim()).filter(Boolean),
    };
    const years = str("yearsExperience");
    if (years) body.yearsExperience = Number(years);
    // Masked contact details are never sent back — only fields the user actually typed.
    if (!initial?.piiMasked) { body.mobile = str("mobile"); body.email = str("email"); }
    if (!editing) {
      body.projects = projects.filter((p) => p.projectName.trim()).map((p) => ({
        projectName: p.projectName, role: p.role, productionCompany: p.productionCompany, platformName: p.platformName,
        ...(p.releaseYear ? { releaseYear: Number(p.releaseYear) } : {}), languageKey: p.languageKey, genreKey: p.genreKey,
        projectStatus: p.projectStatus, description: p.description, externalLinks: p.link ? [{ label: "Link", url: p.link }] : [],
      }));
    }
    try {
      const r = editing
        ? await api<{ id: string }>("PATCH", `/api/v1/creators/${initial!.id}`, body)
        : await api<{ id: string }>("POST", "/api/v1/creators", body);
      window.location.assign(`/creators/${r.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      if (err instanceof ApiError && err.fields) setFields(err.fields);
    } finally { setBusy(false); }
  }

  const setP = (i: number, k: keyof Project, v: string) => setProjects((ps) => ps.map((p, j) => (j === i ? { ...p, [k]: v } : p)));
  const fe = (k: string) => fields[k] ? <span className="field-error">{fields[k]}</span> : null;

  if (step === "check") {
    return (
      <form className="section" onSubmit={runCheck}>
        <h2>1. Check if this person already exists</h2>
        <p className="subtle">We never create duplicate creator profiles. Search by name, mobile or email first.</p>
        {error && <p className="error" role="alert">{error}</p>}
        <div className="form-grid">
          <label className="field">Full name<input value={check.name} onChange={(e) => setCheck({ ...check, name: e.target.value })} /></label>
          <label className="field">Mobile<input value={check.mobile} inputMode="tel" onChange={(e) => setCheck({ ...check, mobile: e.target.value })} /></label>
          <label className="field">Email<input type="email" value={check.email} onChange={(e) => setCheck({ ...check, email: e.target.value })} /></label>
        </div>
        <div className="row-actions"><button className="btn-inline" disabled={busy}>Search existing creators</button></div>
        {matches && matches.length > 0 && (
          <div className="section">
            <h2>Possible matches</h2>
            <table className="data"><tbody>
              {matches.map((m) => (
                <tr key={m.id}><td><strong>{m.fullName}</strong><div className="muted">{m.mobile ?? ""} · matched on {m.matchedOn.join(", ")}</div></td>
                  <td><a className="btn-secondary" href={`/creators/${m.id}`}>Use existing creator</a></td></tr>
              ))}
            </tbody></table>
            <div className="row-actions"><button type="button" className="btn-secondary" onClick={() => setStep("form")}>None of these — create new creator profile</button></div>
          </div>
        )}
      </form>
    );
  }

  return (
    <form onSubmit={submit} noValidate>
      {error && <p className="error" role="alert">{error}</p>}
      <div className="section">
        <h2>Basic profile</h2>
        <div className="form-grid">
          <label className="field">Full name *<input name="fullName" required defaultValue={initial?.fullName ?? check.name} />{fe("fullName")}</label>
          <label className="field">Professional role *<select name="creatorType" defaultValue={initial?.creatorType ?? "WRITER"}>{ROLES.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}</select></label>
          {initial?.piiMasked ? (
            <p className="hint full">Contact details are hidden for your role and cannot be edited here.</p>
          ) : (
            <>
              <label className="field">Mobile<input name="mobile" inputMode="tel" defaultValue={initial?.mobile ?? check.mobile} />{fe("mobile")}</label>
              <label className="field">Email<input name="email" type="email" defaultValue={initial?.email ?? check.email} />{fe("email")}</label>
            </>
          )}
          <label className="field">Location<input name="location" defaultValue={initial?.location ?? ""} /></label>
          <label className="field">Years of experience<input name="yearsExperience" type="number" min={0} max={80} defaultValue={initial?.yearsExperience ?? ""} />{fe("yearsExperience")}</label>
          <fieldset className="field full"><legend>Languages</legend>
            <div className="chips">{languages.map((l) => (
              <label key={l.key} className="chip"><input type="checkbox" name="languageKeys" value={l.key} defaultChecked={initial?.languageKeys?.includes(l.key)} /> {l.label}</label>
            ))}</div>
          </fieldset>
          <label className="field full">Professional bio<textarea name="bio" defaultValue={initial?.bio ?? ""} /></label>
        </div>
      </div>
      <div className="section">
        <h2>Career</h2>
        <div className="form-grid">
          <label className="field">Agency / representation<input name="agency" defaultValue={initial?.agency ?? ""} /></label>
          <label className="field">Website<input name="website" type="url" placeholder="https://" defaultValue={initial?.website ?? ""} />{fe("website")}</label>
          <label className="field full">Previous production companies<input name="previousCompanies" placeholder="Comma separated" defaultValue={initial?.previousCompanies?.join(", ") ?? ""} /></label>
          <label className="field">Consent / legal basis<select name="consentBasis" defaultValue={initial?.consentBasis ?? ""}>
            <option value="">Not recorded</option><option value="SUBMISSION_AGREEMENT">Signed submission agreement</option>
            <option value="EMAIL_CONSENT">Consent by email</option><option value="LEGITIMATE_BUSINESS">Legitimate business contact</option></select></label>
          <label className="field full">Internal notes<textarea name="notes" defaultValue={initial?.notes ?? ""} /></label>
        </div>
      </div>
      {!editing && (
        <div className="section">
          <h2>Projects worked on</h2>
          <p className="subtle">For first-time creators. These stay on the profile for future pitches.</p>
          {projects.map((p, i) => (
            <div key={i} className="form-grid section">
              <label className="field">Project name<input value={p.projectName} onChange={(e) => setP(i, "projectName", e.target.value)} /></label>
              <label className="field">Role<select value={p.role} onChange={(e) => setP(i, "role", e.target.value)}>{ROLES.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}</select></label>
              <label className="field">Production company<input value={p.productionCompany} onChange={(e) => setP(i, "productionCompany", e.target.value)} /></label>
              <label className="field">Platform / channel<input value={p.platformName} onChange={(e) => setP(i, "platformName", e.target.value)} /></label>
              <label className="field">Release year<input type="number" min={1900} max={2100} value={p.releaseYear} onChange={(e) => setP(i, "releaseYear", e.target.value)} /></label>
              <label className="field">Language<select value={p.languageKey} onChange={(e) => setP(i, "languageKey", e.target.value)}><option value="">—</option>{languages.map((l) => <option key={l.key} value={l.key}>{l.label}</option>)}</select></label>
              <label className="field">Genre<select value={p.genreKey} onChange={(e) => setP(i, "genreKey", e.target.value)}><option value="">—</option>{genres.map((g) => <option key={g.key} value={g.key}>{g.label}</option>)}</select></label>
              <label className="field">Status<input value={p.projectStatus} placeholder="Released, In production…" onChange={(e) => setP(i, "projectStatus", e.target.value)} /></label>
              <label className="field">External link<input type="url" placeholder="https://" value={p.link} onChange={(e) => setP(i, "link", e.target.value)} /></label>
              <label className="field full">Description<textarea value={p.description} onChange={(e) => setP(i, "description", e.target.value)} /></label>
              <div className="full"><button type="button" className="btn-secondary" onClick={() => setProjects((ps) => ps.filter((_, j) => j !== i))}>Remove project</button></div>
            </div>
          ))}
          <button type="button" className="btn-secondary" onClick={() => setProjects((ps) => [...ps, emptyProject()])}>+ Add project</button>
        </div>
      )}
      <div className="row-actions"><button className="btn-inline" disabled={busy}>{editing ? "Save changes" : "Create creator profile"}</button></div>
    </form>
  );
}
