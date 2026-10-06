"use client";

import { api } from "./client-api";

export function CreatorLogoutButton() {
  return (
    <button type="button" className="btn-secondary" onClick={async () => { try { await api("POST", "/api/v1/creator/logout"); } finally { window.location.assign("/creator"); } }}>
      Sign out
    </button>
  );
}
