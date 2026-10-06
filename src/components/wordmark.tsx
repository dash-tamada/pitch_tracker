/**
 * The Pitch Tracker lockup: a clapper mark plus the wordmark, PITCH in ink and
 * TRACKER in the house orange. Drawn as inline SVG rather than an image file so it
 * stays crisp at any size and inherits its colour from the surface it sits on.
 *
 * `tone="light"` is for dark surfaces (the camera stage on the sign-in page): the mark
 * and PITCH turn cream, and the cut-outs in the mark turn dark to stay visible.
 */
export function Wordmark({ tone = "dark" }: { tone?: "dark" | "light" }) {
  return (
    <div className={tone === "light" ? "wordmark wordmark-light" : "wordmark"}>
      <svg className="wordmark-mark" viewBox="0 0 32 32" role="img" aria-label="Pitch Tracker">
        {/* the slate */}
        <rect x="1" y="11" width="30" height="20" rx="2.6" fill="currentColor" />
        {/* the arm, hinged open, with its stripes cut through */}
        <g transform="rotate(-9 16 16)">
          <rect x="1" y="1.6" width="30" height="7.2" rx="1.4" fill="currentColor" />
          <path className="wm-cut" d="M6.2 1.6h3.4l-2.6 7.2H3.6z" fill="#fff" />
          <path className="wm-cut" d="M13.2 1.6h3.4l-2.6 7.2h-3.4z" fill="#fff" />
          <path className="wm-cut" d="M20.2 1.6h3.4l-2.6 7.2h-3.4z" fill="#fff" />
          <path className="wm-cut" d="M27.2 1.6h3.4l-2.6 7.2h-3.4z" fill="#fff" />
        </g>
        {/* ruled rows on the slate */}
        <rect className="wm-cut" x="5" y="17" width="14" height="1.8" rx=".9" fill="#fff" opacity=".82" />
        <rect className="wm-cut" x="5" y="22" width="9" height="1.8" rx=".9" fill="#fff" opacity=".5" />
      </svg>
      <span className="wordmark-text">Pitch<em>Tracker</em></span>
    </div>
  );
}
