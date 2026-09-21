import Link from "next/link";
import { fmtDate } from "./ui";

/**
 * A creator on the call sheet: initials on a coloured disc, the craft they work in, and the
 * contact details, on a stub that tears along a perforated edge. Same fixed-class trick as the
 * pitch poster — the CSP forbids inline styles, so the colourway is one of a fixed set.
 */
const VARIANTS = 6;

function variant(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) { h ^= seed.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0) % VARIANTS;
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const first = parts[0]!.charAt(0);
  const last = parts.length > 1 ? parts[parts.length - 1]!.charAt(0) : "";
  return (first + last).toUpperCase();
}

export type CrewMember = {
  id: string;
  fullName: string;
  role: string;
  mobile: string | null;
  location: string | null;
  createdAt: Date | string;
};

export function CrewCard({ c }: { c: CrewMember }) {
  return (
    <Link className="crew-card" href={`/creators/${c.id}`}>
      <span className={`crew-disc cv-${variant(c.id)}`} aria-hidden="true">{initials(c.fullName)}</span>
      <span className="crew-main">
        <span className="crew-name">{c.fullName}</span>
        <span className="crew-role">{c.role}</span>
        <span className="crew-rows">
          <span><b>Mobile</b>{c.mobile ?? "—"}</span>
          <span><b>Based in</b>{c.location ?? "—"}</span>
          <span><b>On file</b>{fmtDate(c.createdAt)}</span>
        </span>
      </span>
      <span className="crew-go" aria-hidden="true">→</span>
    </Link>
  );
}
