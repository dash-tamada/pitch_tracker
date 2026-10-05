import Link from "next/link";

/**
 * Dashboard masthead in the soft "bento" style: a bright rounded card with a peach glow, a headline
 * with one italic word, pill buttons and three live numbers. Specks drift left-to-right behind the
 * text. Their positions, sizes and speeds are fixed classes (.dust-1 … .dust-16) because the CSP
 * forbids inline styles; the motion is switched off under prefers-reduced-motion.
 */
const DUST = Array.from({ length: 16 }, (_, i) => i + 1);

export function HeroBanner({
  name, total, inReview, inProduction, canCreate,
}: {
  /** Company name, so the masthead reads as this studio's own control room. */
  name: string;
  total: number;
  inReview: number;
  inProduction: number;
  canCreate: boolean;
}) {
  return (
    <section className="hero">
      <div className="dust" aria-hidden="true">
        {DUST.map((n) => <span key={n} className={`dust-${n}`} />)}
      </div>
      <span className="hero-eyebrow">Story Pipeline</span>
      <h1 className="hero-title">
        Every story, <span className="italic-accent">tracked</span> from pitch to screen
      </h1>
      <p className="hero-sub">
        Who has it, at which level, since when, what they said and what happens next — {name}&rsquo;s
        whole slate in one place.
      </p>
      <div className="hero-cta">
        {canCreate && <Link className="pill pill-dark" href="/pitches/new">+ New pitch</Link>}
        <Link className="pill pill-light" href="/pitches">View all pitches</Link>
      </div>
      <div className="hero-strip">
        <div><div className="n">{total}</div><div className="k">Total pitches</div></div>
        <div><div className="n">{inReview}</div><div className="k">Under review</div></div>
        <div><div className="n">{inProduction}</div><div className="k">In production</div></div>
      </div>
    </section>
  );
}
