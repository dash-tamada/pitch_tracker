/**
 * The cinematic masthead on the dashboard: the theatre photograph, a headline with one
 * italic word, and the three numbers that say how much work is actually in the building.
 * The image is served from /public (the CSP is `img-src 'self'`), never a remote CDN.
 */
export function HeroBanner({
  name, total, inReview, inProduction,
}: {
  /** Company name, so the masthead reads as this studio's own control room. */
  name: string;
  total: number;
  inReview: number;
  inProduction: number;
}) {
  return (
    <section className="hero">
      <span className="hero-eyebrow">Story Pipeline</span>
      <h1 className="hero-title">
        Every story, <span className="italic-accent">tracked</span> from pitch to screen
      </h1>
      <p className="hero-sub">
        Who has it, at which level, since when, what they said and what happens next — {name}&rsquo;s
        whole slate in one place.
      </p>
      <div className="hero-strip">
        <div><div className="n">{total}</div><div className="k">Total pitches</div></div>
        <div><div className="n">{inReview}</div><div className="k">Under review</div></div>
        <div><div className="n">{inProduction}</div><div className="k">In production</div></div>
      </div>
    </section>
  );
}
