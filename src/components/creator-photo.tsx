"use client";

import { useState, type ChangeEvent } from "react";
import { api, csrfHeader } from "./client-api";

/**
 * The writer's profile photo. Required: the studio stays closed until there is one. Same three steps as every upload here —
 * ask for a one-time URL, send the file straight to private storage, then let the server check the bytes really are a picture.
 */
export function CreatorPhoto({ hasPhoto, required = false }: { hasPhoto: boolean; required?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const [has, setHas] = useState(hasPhoto);

  async function pick(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setBusy(true); setError(null);
    try {
      const intent = await api<{ key: string; uploadUrl: string }>("POST", "/api/v1/creator/profile/photo", { filename: file.name, sizeBytes: file.size });
      const sameOrigin = intent.uploadUrl.startsWith("/");
      const form = new FormData();
      form.append("cacheControl", "3600");
      form.append("", file);
      const put = await fetch(intent.uploadUrl, { method: "PUT", body: form, credentials: sameOrigin ? "same-origin" : "omit", headers: sameOrigin ? csrfHeader() : { "x-upsert": "false" } });
      if (!put.ok) throw new Error("Upload failed. Please try again.");
      await api("POST", "/api/v1/creator/profile/photo/complete", { key: intent.key });
      setHas(true); setVersion((v) => v + 1);
      if (required) window.location.assign("/creator?welcome=1"); // the photo was the last thing the studio needed
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed.");
    } finally { setBusy(false); }
  }

  return (
    <div className="photo-box">
      <div className={has ? "photo-ring has" : "photo-ring"}>
        {has
          // eslint-disable-next-line @next/next/no-img-element -- a signed, short-lived storage link behind our own route
          ? <img src={`/api/v1/creator/profile/photo?v=${version}`} alt="Your profile photo" />
          : <span aria-hidden="true">+</span>}
      </div>
      <div>
        <label className={busy ? "btn-inline is-busy" : "btn-inline"}>
          {busy ? "Uploading…" : has ? "Change photo" : "Upload your photo *"}
          <input type="file" accept="image/jpeg,image/png,image/webp" onChange={pick} disabled={busy} hidden />
        </label>
        <p className="subtle">{required && !has ? "A clear face photo is required before you can start pitching." : "JPG, PNG or WEBP, up to 8 MB."}</p>
        {error && <p className="error" role="alert">{error}</p>}
      </div>
    </div>
  );
}
