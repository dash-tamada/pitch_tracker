"use client";

import { useEffect, useRef, type ReactNode } from "react";

/**
 * Line-art film-making drawings scattered behind the app. They are original, single-stroke pictograms (a camera, a
 * clapper, a reel…) that react to the cursor: each drifts and tilts at its own depth as the mouse moves (a parallax
 * of faint lines), and the ones near the cursor draw themselves in, brighten and glow orange.
 *
 * Drawn entirely with classes plus a few values set from script (CSSOM, which the CSP allows — only style *attributes*
 * in markup are blocked). Every stroke carries pathLength=1 so "how much of the line is drawn" is one number, --near.
 * Desktop pointers only; with reduced motion the lines stay put and only the near-cursor drawing remains.
 */
const P = { pathLength: 1 } as const;

const reel = (cx: number, cy: number, r: number): ReactNode[] =>
  [0, 72, 144, 216, 288].map((deg) => {
    const a = (deg * Math.PI) / 180;
    return <circle key={deg} cx={cx + Math.cos(a) * r * 0.55} cy={cy + Math.sin(a) * r * 0.55} r={r * 0.2} {...P} />;
  });

const ART: ReactNode[] = [
  // 0 · a film camera on a tripod
  <>
    <rect x="22" y="54" width="62" height="34" rx="4" {...P} />
    <circle cx="40" cy="34" r="16" {...P} /><circle cx="40" cy="34" r="4" {...P} />
    <circle cx="69" cy="37" r="12" {...P} /><circle cx="69" cy="37" r="3" {...P} />
    <path d="M84 62 L106 53 L106 89 L84 80 Z" {...P} />
    <rect x="11" y="62" width="11" height="14" rx="2" {...P} />
    <path d="M40 88 L28 114 M53 88 L53 114 M66 88 L78 114" {...P} />
  </>,
  // 1 · a clapperboard
  <>
    <rect x="16" y="52" width="88" height="54" rx="4" {...P} />
    <path d="M14 46 L96 24 L102 40 L20 62 Z" {...P} />
    <path d="M30 56 L38 34 M48 51 L56 29 M66 46 L74 24 M84 42 L92 20" {...P} />
    <path d="M16 72 H104 M52 52 V106 M78 52 V106" {...P} />
    <path d="M24 86 H44 M58 86 H72 M84 86 H98" {...P} />
  </>,
  // 2 · a film reel
  <>
    <circle cx="60" cy="60" r="46" {...P} /><circle cx="60" cy="60" r="36" {...P} /><circle cx="60" cy="60" r="7" {...P} />
    {reel(60, 60, 46)}
    <path d="M60 14 V4 M104 30 L112 24" {...P} />
  </>,
  // 3 · a director's megaphone
  <>
    <path d="M24 54 L90 24 L90 92 L24 66 Z" {...P} />
    <ellipse cx="92" cy="58" rx="9" ry="34" {...P} />
    <path d="M30 66 L36 96 L50 94 L46 72" {...P} />
    <path d="M24 54 L12 54 L12 66 L24 66" {...P} />
    <path d="M100 30 L112 22 M104 58 H118 M100 86 L112 94" {...P} />
  </>,
  // 4 · a studio spotlight on a stand
  <>
    <rect x="30" y="26" width="42" height="38" rx="5" {...P} />
    <path d="M72 32 L106 14 L106 76 L72 58" {...P} />
    <path d="M28 40 Q52 78 76 40" {...P} />
    <path d="M52 64 V106 M36 114 L52 106 L68 114" {...P} />
    <path d="M40 34 V56 M50 34 V56 M60 34 V56" {...P} />
  </>,
  // 5 · a strip of film
  <>
    <rect x="8" y="34" width="104" height="54" rx="3" {...P} />
    {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => <rect key={`t${i}`} x={13 + i * 12.5} y="38" width="6" height="5" rx="1" {...P} />)}
    {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => <rect key={`b${i}`} x={13 + i * 12.5} y="79" width="6" height="5" rx="1" {...P} />)}
    <rect x="16" y="48" width="26" height="30" {...P} /><rect x="47" y="48" width="26" height="30" {...P} /><rect x="78" y="48" width="26" height="30" {...P} />
  </>,
  // 6 · a boom microphone
  <>
    <path d="M10 108 L88 36" {...P} />
    <ellipse cx="100" cy="28" rx="9" ry="19" transform="rotate(44 100 28)" {...P} />
    <path d="M90 20 L110 38 M86 26 L104 44 M94 14 L114 32" {...P} />
    <path d="M70 52 L84 66 M60 62 L74 76" {...P} />
    <path d="M18 100 L30 112" {...P} />
  </>,
  // 7 · a director's chair
  <>
    <rect x="30" y="20" width="60" height="24" rx="2" {...P} />
    <path d="M30 44 V98 M90 44 V98 M22 60 H98 M30 70 H90" {...P} />
    <path d="M34 98 L86 70 M86 98 L34 70" {...P} />
    <path d="M42 28 H78 M46 36 H74" {...P} />
  </>,
  // 8 · a cinema ticket
  <>
    <path d="M10 36 H110 V50 a10 10 0 0 0 0 20 V84 H10 V70 a10 10 0 0 0 0 -20 Z" {...P} />
    <path d="M80 36 V84" {...P} />
    <path d="M22 54 H64 M22 64 H54 M22 74 H60 M88 52 H100 M88 62 H100 M88 72 H98" {...P} />
  </>,
];

/** Where each drawing sits (percent of the window) and how tilted it rests — set by class, so the CSP stays happy. */
const TILT = [-7, 6, 0, -10, 8, 4, -4, 5, -9];

export function FilmDoodles() {
  const layer = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const root = layer.current;
    if (!root || !window.matchMedia("(pointer: fine)").matches) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const items = Array.from(root.querySelectorAll<HTMLElement>(".fd"));
    const depth = items.map((_, i) => 0.4 + (i % 4) * 0.2);
    const near = items.map(() => 0);
    let centres: { x: number; y: number }[] = [];
    const cursor = { x: window.innerWidth / 2, y: window.innerHeight / 2 };
    const eased = { x: 0, y: 0 };
    let raf = 0;

    const measure = () => { centres = items.map((el) => ({ x: el.offsetLeft + el.offsetWidth / 2, y: el.offsetTop + el.offsetHeight / 2 })); };

    const frame = () => {
      raf = 0;
      const tx = (cursor.x / window.innerWidth - 0.5) * 2, ty = (cursor.y / window.innerHeight - 0.5) * 2;
      eased.x += (tx - eased.x) * 0.08; eased.y += (ty - eased.y) * 0.08;
      let busy = Math.abs(tx - eased.x) > 0.002 || Math.abs(ty - eased.y) > 0.002;
      items.forEach((el, i) => {
        const c = centres[i];
        if (!c) return;
        if (!reduced) {
          el.style.transform = `translate3d(${(-eased.x * depth[i]! * 34).toFixed(1)}px, ${(-eased.y * depth[i]! * 26).toFixed(1)}px, 0) rotate(${(TILT[i]! + eased.x * depth[i]! * 5).toFixed(2)}deg)`;
        }
        const d = Math.hypot(cursor.x - c.x, cursor.y - c.y);
        const want = Math.pow(Math.max(0, 1 - d / 340), 1.4);
        const next = near[i]! + (want - near[i]!) * 0.14;
        if (Math.abs(want - next) > 0.004) busy = true;
        near[i] = next;
        el.style.setProperty("--near", next.toFixed(3));
      });
      if (busy) raf = requestAnimationFrame(frame);
    };
    const kick = () => { if (!raf) raf = requestAnimationFrame(frame); };
    const onMove = (e: PointerEvent) => { cursor.x = e.clientX; cursor.y = e.clientY; kick(); };

    measure();
    kick();
    window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("resize", measure);
    return () => { window.removeEventListener("pointermove", onMove); window.removeEventListener("resize", measure); cancelAnimationFrame(raf); };
  }, []);

  return (
    <div ref={layer} className="fd-layer" aria-hidden="true">
      {ART.map((art, i) => (
        <div key={i} className={`fd fd-${i + 1}`}>
          <svg viewBox="0 0 120 120">{art}</svg>
        </div>
      ))}
    </div>
  );
}
