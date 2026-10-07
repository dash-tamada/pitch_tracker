"use client";

import type { Dispatch, SetStateAction } from "react";

/**
 * The writer's details form, shared by sign-up and the profile editor: who they are, how long they have worked, the
 * projects they have worked on and the credit they held, and their IMDB / showreel / other links. Controlled: the parent
 * keeps the state (so it can validate and submit) and this only draws the fields. Photo is handled separately.
 */
export interface DetailsState {
  fullName: string; creatorType: string; experienceYears: string; bio: string; imdbUrl: string; showreelUrl: string;
  otherLinks: { label: string; url: string }[];
  credits: { projectTitle: string; credit: string; releaseYear: string; link: string }[];
}

export const EMPTY_DETAILS: DetailsState = {
  fullName: "", creatorType: "WRITER", experienceYears: "", bio: "", imdbUrl: "", showreelUrl: "", otherLinks: [], credits: [],
};

export const CREATOR_TYPE_OPTIONS: [string, string][] = [
  ["WRITER", "Writer"], ["DIRECTOR", "Director"], ["WRITER_DIRECTOR", "Writer-Director"], ["PRODUCER", "Producer"], ["CREATOR", "Creator"], ["OTHER", "Other"],
];
export const CREDIT_SUGGESTIONS = ["Writer", "Story", "Screenplay", "Dialogues", "Director", "Associate director", "Assistant director", "Producer", "Lyricist", "Creator", "Showrunner"];

/** The form's strings → the body the API expects (blanks left out, numbers as numbers). */
export function toPayload(d: DetailsState) {
  const num = (v: string) => (v.trim() === "" ? undefined : Number(v));
  return {
    fullName: d.fullName.trim(), creatorType: d.creatorType,
    experienceYears: num(d.experienceYears), bio: d.bio.trim(), imdbUrl: d.imdbUrl.trim(), showreelUrl: d.showreelUrl.trim(),
    otherLinks: d.otherLinks.filter((l) => l.label.trim() || l.url.trim()).map((l) => ({ label: l.label.trim(), url: l.url.trim() })),
    credits: d.credits.filter((c) => c.projectTitle.trim() || c.credit.trim()).map((c) => ({
      projectTitle: c.projectTitle.trim(), credit: c.credit.trim(), releaseYear: num(c.releaseYear), link: c.link.trim(),
    })),
  };
}

export function ProfileFields({ value, onChange, showName = true }: { value: DetailsState; onChange: Dispatch<SetStateAction<DetailsState>>; showName?: boolean }) {
  const set = <K extends keyof DetailsState>(k: K, v: DetailsState[K]) => onChange((d) => ({ ...d, [k]: v }));
  const setCredit = (i: number, patch: Partial<DetailsState["credits"][number]>) => onChange((d) => ({ ...d, credits: d.credits.map((c, k) => (k === i ? { ...c, ...patch } : c)) }));
  const setLink = (i: number, patch: Partial<DetailsState["otherLinks"][number]>) => onChange((d) => ({ ...d, otherLinks: d.otherLinks.map((l, k) => (k === i ? { ...l, ...patch } : l)) }));

  return (
    <>
      <div className="form-grid">
        {showName && <label className="field">Your name *<input value={value.fullName} onChange={(e) => set("fullName", e.target.value)} autoComplete="name" maxLength={120} required /></label>}
        <label className="field">You are a *<select value={value.creatorType} onChange={(e) => set("creatorType", e.target.value)}>
          {CREATOR_TYPE_OPTIONS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
        <label className="field">Years of experience<input type="number" min={0} max={80} value={value.experienceYears} onChange={(e) => set("experienceYears", e.target.value)} placeholder="e.g. 6" /></label>
        <label className="field full">About you<textarea rows={4} maxLength={2000} value={value.bio} onChange={(e) => set("bio", e.target.value)} placeholder="Your background, the kind of stories you tell, what you have made so far." /></label>
      </div>

      <h3 className="pf-heading">Projects you have worked on</h3>
      <p className="subtle">Add each project with the credit you held on it.</p>
      <datalist id="pf-credits">{CREDIT_SUGGESTIONS.map((c) => <option key={c} value={c} />)}</datalist>
      {value.credits.map((c, i) => (
        <div className="pf-row pf-credit" key={i}>
          <label className="field">Project<input value={c.projectTitle} onChange={(e) => setCredit(i, { projectTitle: e.target.value })} maxLength={200} placeholder="Film or series title" /></label>
          <label className="field">Credit<input list="pf-credits" value={c.credit} onChange={(e) => setCredit(i, { credit: e.target.value })} maxLength={120} placeholder="e.g. Writer" /></label>
          <label className="field">Year<input type="number" min={1900} max={2100} value={c.releaseYear} onChange={(e) => setCredit(i, { releaseYear: e.target.value })} placeholder="2024" /></label>
          <label className="field">Link<input type="url" value={c.link} onChange={(e) => setCredit(i, { link: e.target.value })} maxLength={500} placeholder="https://…" /></label>
          <button type="button" className="pf-remove" aria-label="Remove this project" onClick={() => onChange((d) => ({ ...d, credits: d.credits.filter((_, k) => k !== i) }))}>×</button>
        </div>
      ))}
      <button type="button" className="btn-secondary" onClick={() => onChange((d) => ({ ...d, credits: [...d.credits, { projectTitle: "", credit: "", releaseYear: "", link: "" }] }))}>+ Add a project</button>

      <h3 className="pf-heading">Links</h3>
      <div className="form-grid">
        <label className="field">IMDB link<input type="url" value={value.imdbUrl} onChange={(e) => set("imdbUrl", e.target.value)} maxLength={500} placeholder="https://www.imdb.com/name/…" /></label>
        <label className="field">Showreel link<input type="url" value={value.showreelUrl} onChange={(e) => set("showreelUrl", e.target.value)} maxLength={500} placeholder="YouTube, Vimeo or Drive link" /></label>
      </div>
      {value.otherLinks.map((l, i) => (
        <div className="pf-row pf-link" key={i}>
          <label className="field">Label<input value={l.label} onChange={(e) => setLink(i, { label: e.target.value })} maxLength={40} placeholder="e.g. Instagram, Wikipedia" /></label>
          <label className="field">Link<input type="url" value={l.url} onChange={(e) => setLink(i, { url: e.target.value })} maxLength={500} placeholder="https://…" /></label>
          <button type="button" className="pf-remove" aria-label="Remove this link" onClick={() => onChange((d) => ({ ...d, otherLinks: d.otherLinks.filter((_, k) => k !== i) }))}>×</button>
        </div>
      ))}
      {value.otherLinks.length < 8 && <button type="button" className="btn-secondary" onClick={() => onChange((d) => ({ ...d, otherLinks: [...d.otherLinks, { label: "", url: "" }] }))}>+ Add another link</button>}
    </>
  );
}
