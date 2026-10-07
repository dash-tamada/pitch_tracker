"use client";

import { useState } from "react";
import { api } from "./client-api";

/**
 * Log out: ends the session and goes straight to the sign-in screen.
 *
 * It lands on /login?signedout=1 rather than plain /login so that, on a developer machine running the local
 * DEV_AUTO_LOGIN shortcut, logging out actually stays logged out instead of being signed straight back in.
 */
export function LogoutButton() {
  const [busy, setBusy] = useState(false);

  async function logout() {
    if (busy) return;
    setBusy(true);
    try { await api("POST", "/api/v1/auth/logout"); } catch { /* leave anyway: the session ends on its own */ }
    window.location.assign("/login?signedout=1");
  }

  return (
    <button type="button" className="btn-secondary logout-btn" onClick={logout} disabled={busy}>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><path d="m16 17 5-5-5-5" /><path d="M21 12H9" />
      </svg>
      {busy ? "Logging out…" : "Log out"}
    </button>
  );
}
