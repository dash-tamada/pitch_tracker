"use client";

import { useState } from "react";
import { api } from "./client-api";

export function PortalLogoutButton({ token }: { token: string }) {
  const [busy, setBusy] = useState(false);
  async function onClick() {
    setBusy(true);
    try { await api("POST", `/api/v1/portal/${token}/logout`); } finally { window.location.assign(`/portal/${token}`); }
  }
  return <button type="button" className="btn-secondary" onClick={onClick} disabled={busy}>Sign out</button>;
}
