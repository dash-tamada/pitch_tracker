"use client";

import { useCallback, useState, type ReactNode } from "react";
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
    window.setTimeout(() => window.location.assign(href), CLAP_MS);
  }, []);
  return { clapping, clapThen };
}

export function Clapboard({
  title, scene, children, clapping = false,
}: {
  title: string;
  /** Optional context line under the lockup, e.g. which portal this board belongs to. */
  scene?: string;
  children: ReactNode;
  clapping?: boolean;
}) {
  return (
    <div className={clapping ? "clap is-clapping" : "clap"}>
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
          {children}
        </div>
      </div>
      <div className="clap-flash" aria-hidden="true" />
    </div>
  );
}
