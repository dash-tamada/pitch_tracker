import Link from "next/link";

/**
 * The cinematic masthead on the dashboard: artwork on the right (served from /public — the CSP is `img-src 'self'`),
 * a headline with one brush-stroked word, and the two entry buttons. Embers drift left to right behind the text; their
 * positions, sizes and speeds are fixed classes (.dust-1 … .dust-16) because the CSP forbids inline styles, and the motion
 * is switched off under prefers-reduced-motion.
 */
const DUST = Array.from({ length: 16 }, (_, i) => i + 1);

export function HeroBanner({ name, canCreate }: { name: string; canCreate: boolean }) {
  return (
    <section className="hero">
      <div className="hero-art" aria-hidden="true" />
      <div className="dust" aria-hidden="true">
        {DUST.map((n) => <span key={n} className={`dust-${n}`} />)}
      </div>
      <div className="hero-copy">
        <p className="hero-eyebrow"><span>Story Pipeline</span></p>
        <h1 className="hero-title">
          <span className="hl">Every story,</span>
          <span className="hl hero-brush">tracked
            <svg className="hero-stroke" viewBox="0 0 380 26" preserveAspectRatio="none" aria-hidden="true">
              <path d="M4 17 C 80 7, 160 19, 250 10 S 350 9, 376 13" />
              <path d="M30 22 C 120 15, 210 23, 330 17" />
            </svg>
          </span>
          <span className="hl">from pitch</span>
          <span className="hl">to screen</span>
        </h1>
        <p className="hero-sub">
          Who has it, at which level, since when, what they said and what happens next — {name}&rsquo;s whole slate in one place.
        </p>
        <div className="hero-cta">
          {canCreate && (
            <Link className="pill pill-fire" href="/pitches/new">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
              New pitch
            </Link>
          )}
          <Link className="pill pill-ghost" href="/pitches">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 4.5v15l13-7.5-13-7.5Z" /></svg>
            View all pitches
          </Link>
        </div>
      </div>
    </section>
  );
}
