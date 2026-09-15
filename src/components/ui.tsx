import Link from "next/link";
import type { ReactNode } from "react";

const BADGE_CLASS: Record<string, string> = {
  new: "b-new", under_review: "b-review", awaiting_approval: "b-review", changes_requested: "b-hold", on_hold: "b-hold",
  rejected: "b-rejected", approved: "b-approved", platform: "b-platform", platform_approved: "b-approved",
  ready_to_go: "b-ready", development: "b-dev", greenlit: "b-ready", production: "b-prod", completed: "b-prod", released: "b-prod",
};
const BADGE_ICON: Record<string, string> = {
  under_review: "🟡", awaiting_approval: "🟡", rejected: "🔴", approved: "🟢", platform: "🔵", platform_approved: "🟢",
  ready_to_go: "👍", development: "🟣", greenlit: "👍", production: "🎬", completed: "🎬", released: "🎬", on_hold: "⏸", changes_requested: "✏️",
};

export function StageBadge({ badge, label }: { badge: string | null | undefined; label: string }) {
  const b = badge ?? "new";
  return <span className={`badge ${BADGE_CLASS[b] ?? "b-new"}`}><span aria-hidden="true">{BADGE_ICON[b] ?? "•"}</span> {label}</span>;
}

export function Stars({ value }: { value: number | null | undefined }) {
  if (value === null || value === undefined) return <span className="muted">Not rated</span>;
  const full = Math.round(value);
  return <span className="stars" aria-label={`${value} out of 5`}>{"★".repeat(full)}{"☆".repeat(5 - full)} <span className="muted">{value.toFixed(1)}</span></span>;
}

export function Tabs({ base, current, tabs }: { base: string; current: string; tabs: { key: string; label: string }[] }) {
  return (
    <nav className="tabs" aria-label="Sections">
      {tabs.map((t) => (
        <Link key={t.key} href={`${base}?tab=${t.key}`} className={t.key === current ? "tab active" : "tab"} aria-current={t.key === current ? "page" : undefined}>{t.label}</Link>
      ))}
    </nav>
  );
}

export function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) {
  return <div className="card" title={hint}><div className="label">{label}</div><div className="value">{value}</div></div>;
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="empty">{children}</p>;
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="page-head">
      <div><h1 className="page-title">{title}</h1>{subtitle && <p className="subtle">{subtitle}</p>}</div>
      {actions && <div className="head-actions">{actions}</div>}
    </div>
  );
}

export const fmtDate = (d: Date | string | null | undefined) =>
  d ? new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: "Asia/Kolkata" }) : "—";
export const fmtDateTime = (d: Date | string | null | undefined) =>
  d ? new Date(d).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" }) : "—";
export const daysSince = (d: Date | string | null | undefined, now = new Date()) =>
  d ? Math.max(0, Math.floor((now.getTime() - new Date(d).getTime()) / 86_400_000)) : 0;
