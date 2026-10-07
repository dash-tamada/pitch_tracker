import Link from "next/link";

/**
 * The Creator Studio masthead — the same cinematic banner as the staff dashboard, but the director's chair carries the
 * writer's own name. The artwork is the studio picture with its lettering painted out (/img/hero-art-blank.jpg); the name
 * is real text laid over the chair back, sized from the picture's own width so it stays on the canvas at any screen size.
 * The text sits in a sibling of the masked picture, so the picture's soft edges never fade it.
 */
const sizeClass = (name: string) => (name.length <= 9 ? "cn-l" : name.length <= 14 ? "cn-m" : "cn-s");

export function StudioHero({ name, firstName }: { name: string; firstName: string }) {
  return (
    <section className="hero hero-studio">
      <div className="hero-art" aria-hidden="true" />
      <div className="studio-chair" aria-hidden="true">
        <span className={`chair-name ${sizeClass(name)}`}>{name}</span>
      </div>
      <div className="hero-copy">
        <p className="hero-eyebrow"><span>Creator Studio</span></p>
        <h1 className="hero-title">
          Welcome, {firstName}.<br />Your stories, ready to <span className="hero-brush">pitch
            <svg className="hero-stroke" viewBox="0 0 380 26" preserveAspectRatio="none" aria-hidden="true">
              <path d="M4 17 C 80 7, 160 19, 250 10 S 350 9, 376 13" />
            </svg>
          </span>
        </h1>
        <p className="hero-sub">Write your pitch, add your script and poster, then send it to the production houses that are accepting pitches.</p>
        <div className="hero-cta">
          <Link className="pill pill-fire" href="/creator/drafts/new">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
            New pitch
          </Link>
          <Link className="pill pill-ghost" href="/creator/houses">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 4.5v15l13-7.5-13-7.5Z" /></svg>
            Production houses
          </Link>
        </div>
      </div>
    </section>
  );
}
