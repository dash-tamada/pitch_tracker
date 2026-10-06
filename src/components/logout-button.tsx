"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import { api } from "./client-api";
import { soundEnabled } from "./film-sound";
import { CUT_EVENT, loadTake, speak } from "./viewfinder";

const HOLD_MS = 10_000; // how long "Shot OK" stays up before the sign-in screen

/**
 * "Cut": stops the camera overlay recording, calls "Shot OK" over the blurred page with the take and clip number from
 * this login, signs the person out, then returns to the sign-in screen after ten seconds. The overlay is drawn straight on
 * <body>: the top bar this button lives in is animated, and an animated ancestor would pin a "fixed" overlay to the bar.
 */
export function LogoutButton() {
  const [shot, setShot] = useState<{ take: string; clip: string } | null>(null);

  async function cut() {
    if (shot) return;
    const t = loadTake();
    setShot({ take: t?.take ?? "001", clip: t?.clip ?? "C001" });
    window.dispatchEvent(new Event(CUT_EVENT));
    speak("Shot OK", soundEnabled());
    const began = Date.now();
    try { await api("POST", "/api/v1/auth/logout"); } catch { /* leave anyway: the session ends on its own */ }
    window.setTimeout(() => window.location.assign("/login"), Math.max(0, HOLD_MS - (Date.now() - began)));
  }

  return (
    <>
      <button className="btn-secondary" onClick={cut} disabled={Boolean(shot)} aria-label="Cut: stop recording and sign out">Cut</button>
      {shot && createPortal(
        <div className="cut-overlay" role="status" aria-live="assertive">
          <div className="cut-card">
            <p className="cut-shot">Shot OK</p>
            <p className="cut-meta"><span>Take <b>{shot.take}</b></span><span>Clip <b>{shot.clip}</b></span></p>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
