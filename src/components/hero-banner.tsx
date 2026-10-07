import Link from "next/link";

/**
 * The dashboard masthead: a compact banner — the studio artwork on the right (served from /public; the CSP is
 * `img-src 'self'`), a headline with one brush-stroked word, and the two entry points. It is deliberately short so the
 * numbers and the work waiting for you sit above the fold; the dashboard is a place to act, not a landing page.
 */
export function HeroBanner({ name, canCreate }: { name: string; canCreate: boolean }) {
  return (
    <section className="hero">
      <div className="hero-art" aria-hidden="true" />
      <div className="hero-copy">
        <p className="hero-eyebrow"><span>{name} · Story pipeline</span></p>
        <h1 className="hero-title">
          Every story, <span className="hero-brush">tracked
            <svg className="hero-stroke" viewBox="0 0 380 26" preserveAspectRatio="none" aria-hidden="true">
              <path d="M4 17 C 80 7, 160 19, 250 10 S 350 9, 376 13" />
            </svg>
          </span> from pitch to screen
        </h1>
        <p className="hero-sub">Who has each story, at which level, since when — and what happens next.</p>
        <div className="hero-cta">
          {canCreate && (
            <Link className="pill pill-fire" href="/pitches/new">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
              New pitch
            </Link>
          )}
          <Link className="pill pill-ghost" href="/pitches">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 4.5v15l13-7.5-13-7.5Z" /></svg>
            View all pitches
          </Link>
        </div>
      </div>
    </section>
  );
}
