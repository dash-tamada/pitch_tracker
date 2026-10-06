"use client";

import { useCallback, useState, type ReactNode } from "react";
import { playClap, primeAudio } from "./film-sound";
import { Wordmark } from "./wordmark";

/**
 * The clapper board that frames every sign-in / register screen.
 *
 * The form fields sit on the slate as chalk-ruled rows (see `.clap-slate .field` in globals.css);
 * when the credentials are accepted the top stick swings down, the board claps, the frame flashes
 * and only then do we navigate — so entering the app feels like a take being called.
 */

/** Must match the total run time of the `clap-*` keyframes in globals.css. */
export const CLAP_MS = 900;
/** When the sticks meet inside that run: 38% of the clap-swing keyframes. The clap sound is timed to it. */
const CLACK_S = (CLAP_MS * 0.38) / 1000;

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
}

/**
 * Drives the clap. `clapThen(href)` plays the animation and then navigates; with reduced motion
 * it navigates straight away, so the journey never depends on an animation the viewer opted out of.
 */
export function useClap() {
  const [clapping, setClapping] = useState(false);
  const clapThen = useCallback((href: string) => {
    if (prefersReducedMotion()) { window.location.assign(href); return; }
    setClapping(true);
    playClap(CLACK_S);
    window.setTimeout(() => window.location.assign(href), CLAP_MS);
  }, []);
  return { clapping, clapThen };
}

export function Clapboard({
  title, scene, children, clapping = false, take,
}: {
  title: string;
  /** Optional context line under the lockup, e.g. which portal this board belongs to. */
  scene?: string;
  children: ReactNode;
  clapping?: boolean;
  /** Chalk the scene and take number on the slate, e.g. { scene: 12, take: "042" }. */
  take?: { scene: number; take: string };
}) {
  return (
    // Submitting the form is the user gesture that lets the browser start audio; the clap itself only
    // plays once the sign-in request comes back, which is no longer inside that gesture.
    <div className={clapping ? "clap is-clapping" : "clap"} onSubmitCapture={() => { primeAudio(); }}>
      <div className="clap-stick" aria-hidden="true">
        <div className="clap-stripes" />
        <span className="clap-pin clap-pin-a" />
        <span className="clap-pin clap-pin-b" />
      </div>
      <div className="clap-slate">
        <div className="clap-stripes clap-stripes-fixed" aria-hidden="true" />
        <div className="clap-body">
          <Wordmark />
          {scene && <p className="clap-scene">{scene}</p>}
          <h1 className="clap-title">{title}</h1>
          {take && <p className="clap-take" aria-live="polite"><span>Scene <b>{take.scene}</b></span><span>Take <b>{take.take}</b></span></p>}
          {children}
        </div>
      </div>
      <div className="clap-flash" aria-hidden="true" />
    </div>
  );
}
