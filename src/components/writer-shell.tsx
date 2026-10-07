import type { ReactNode } from "react";
import { PosterBackdrop } from "./poster-wall";
import { RgbHistogram } from "./rgb-histogram";
import { Wordmark } from "./wordmark";

/**
 * The frame around every writer-facing page — the company creator portal (/portal/<token>/…) and the platform-wide
 * creator space (/creator/…). It reuses the staff app's own `.shell .main` theme so writers get the same dark studio,
 * type, panels, tables and controls, with the same faint poster backdrop and colour histogram; only the navigation
 * differs: a top bar instead of a sidebar, since writers have two or three destinations, not twelve.
 */
export type WriterNavItem = { href: string; label: string; current?: boolean };

export function WriterShell({ area, nav, actions, children }: {
  /** Which writer space this is, shown beside the wordmark. */
  area: string;
  nav: WriterNavItem[];
  /** Right-hand side of the bar — the sign-out button. */
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="shell writer-shell">
      <PosterBackdrop />
      <RgbHistogram />
      <header className="writer-bar">
        <a className="writer-brand" href={nav[0]?.href ?? "/"}>
          <Wordmark tone="light" />
          <span className="writer-area">{area}</span>
        </a>
        <nav className="writer-nav" aria-label="Writer">
          {nav.map((n) => (
            <a key={n.href} href={n.href} className={n.current ? "writer-link active" : "writer-link"} aria-current={n.current ? "page" : undefined}>{n.label}</a>
          ))}
        </nav>
        {actions && <div className="writer-actions">{actions}</div>}
      </header>
      <main className="main">{children}</main>
    </div>
  );
}

/** Navigation for the company creator portal. */
export const portalNav = (token: string, current: "pitches" | "new" | "profile"): WriterNavItem[] => [
  { href: `/portal/${token}/pitches`, label: "Your pitches", current: current === "pitches" },
  { href: `/portal/${token}/pitches/new`, label: "New pitch", current: current === "new" },
  { href: `/portal/${token}/profile`, label: "My profile", current: current === "profile" },
];

/** Navigation for the platform-wide creator space. */
export const creatorNav = (current: "pitches" | "new" | "houses" | "profile"): WriterNavItem[] => [
  { href: "/creator", label: "Pitches", current: current === "pitches" || current === "new" },
  { href: "/creator/houses", label: "Production Houses", current: current === "houses" },
  { href: "/creator/profile", label: "Profile", current: current === "profile" },
];
