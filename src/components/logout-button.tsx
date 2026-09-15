"use client";

import { api } from "./client-api";

export function LogoutButton() {
  return <button className="btn-secondary" onClick={async () => { try { await api("POST", "/api/v1/auth/logout"); } finally { window.location.assign("/login"); } }}>Sign out</button>;
}
