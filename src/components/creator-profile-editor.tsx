"use client";

import { useState, type FormEvent } from "react";
import { api } from "./client-api";
import { ProfileFields, toPayload, type DetailsState } from "./profile-fields";

/** Edit the details any time: experience, projects and credits, and the links. Saved in one go. */
export function CreatorProfileEditor({ initial }: { initial: DetailsState }) {
  const [details, setDetails] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true); setError(null); setNote(null);
    try { await api("PATCH", "/api/v1/creator/profile", toPayload(details)); setNote("Profile saved."); }
    catch (err) { setError(err instanceof Error ? err.message : "Could not save your profile."); }
    finally { setBusy(false); }
  }

  return (
    <form className="section" onSubmit={save} noValidate>
      <h2>Your details</h2>
      {error && <p className="error" role="alert">{error}</p>}
      {note && <p className="success" role="status">{note}</p>}
      <ProfileFields value={details} onChange={setDetails} />
      <div className="row-actions"><button className="btn-inline" disabled={busy}>{busy ? "Saving…" : "Save profile"}</button></div>
    </form>
  );
}
