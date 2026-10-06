"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { playBeep, playRoll, primeAudio, setSoundEnabled, soundEnabled } from "./film-sound";
import { Wordmark } from "./wordmark";

/**
 * "Lights. Camera." — the opening shot of the sign-in page.
 *
 * A vintage film camera waits on a stage lined with classic Telugu posters. Pressing Record runs the
 * calls of a real take: the camera starts rolling (REC lamp, turning reels, motor and gate sound), the
 * set calls "Roll sound" → "Sound speed" (with the recordist's beep) → "Rolling", light spills from the
 * lens, and the camera pushes in through it as the clapper board pops up. The board's ACTION button
 * then claps — sticks meeting on the beat of the clap sound — and cuts to the app (see clapboard.tsx).
 *
 * Every motion runs once; nothing idles in a loop. The two overlap on purpose: the board starts rising
 * while the camera is still pushing in, so the hand-off reads as one continuous shot rather than a swap.
 *
 * Phases only ever ADD elements and never toggle a class off an animating element, because removing the
 * class that carries an animation would snap it back to its start. The camera keeps `is-rolling` from the
 * moment Record is pressed until it is unmounted.
 */

/** Must match the cam-* and ci-* keyframe timings in globals.css. */
const REVEAL_AT_MS = 2300;  // after "Rolling", under the tail of the flash, the board pops up
const DONE_AT_MS = 2900;    // the push-in (2150ms + 700ms) has finished; take the camera out of the DOM
const ROLL_SOUND_S = 2.55;  // the motor runs until the camera has pushed in
const SPEED_BEEP_S = 1.0;   // the recordist's beep lands on "Sound speed"

type Phase = "idle" | "rolling" | "reveal" | "board";

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
}

export function CameraIntro({ children, skip = false }: {
  children: ReactNode;
  /** Go straight to the board — e.g. returning mid sign-in for the two-factor step, or with an error to show. */
  skip?: boolean;
}) {
  const [phase, setPhase] = useState<Phase>(skip ? "board" : "idle");
  const timers = useRef<number[]>([]);
  const boardRef = useRef<HTMLDivElement>(null);
  const recorded = useRef(false);

  useEffect(() => () => timers.current.forEach((t) => window.clearTimeout(t)), []);

  // Once the board has taken over, put the cursor in its first field so the user can just type.
  useEffect(() => {
    if (phase === "board" && recorded.current) {
      boardRef.current?.querySelector<HTMLInputElement>("input")?.focus({ preventScroll: true });
    }
  }, [phase]);

  function record() {
    if (phase !== "idle") return;
    recorded.current = true;
    if (prefersReducedMotion()) { setPhase("board"); return; }
    if (primeAudio()) { playRoll(ROLL_SOUND_S); playBeep(SPEED_BEEP_S); }
    setPhase("rolling");
    timers.current.push(
      window.setTimeout(() => setPhase("reveal"), REVEAL_AT_MS),
      window.setTimeout(() => setPhase("board"), DONE_AT_MS),
    );
  }

  return (
    <div className={`ci ci-${phase}`}>
      {phase !== "board" && <CameraStage rolling={phase !== "idle"} onRecord={record} />}
      {(phase === "reveal" || phase === "board") && (
        <div className="ci-board" ref={boardRef}>{children}</div>
      )}
      <SoundToggle />
    </div>
  );
}

/** Mute for the camera and clap sounds. Starts "on" and renders that on the server; the stored choice is
 *  read after mount, so server and client markup always agree on first paint. */
function SoundToggle() {
  const [on, setOn] = useState(true);
  useEffect(() => { setOn(soundEnabled()); }, []);
  return (
    <button type="button" className={on ? "sound-btn" : "sound-btn is-off"} aria-pressed={on} aria-label="Sound effects"
      onClick={() => { const next = !on; setSoundEnabled(next); setOn(next); }}>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M11 5 6 9H3v6h3l5 4V5Z" />
        {on ? <><path d="M15.5 8.5a5 5 0 0 1 0 7" /><path d="M18.5 5.5a9 9 0 0 1 0 13" /></> : <><path d="m22 9-6 6" /><path d="m16 9 6 6" /></>}
      </svg>
      <span>{on ? "Sound on" : "Sound off"}</span>
    </button>
  );
}

function CameraStage({ rolling, onRecord }: { rolling: boolean; onRecord: () => void }) {
  return (
    <div className={rolling ? "cam-stage is-rolling" : "cam-stage"}>
      <div className="cam-frame">
        <span className="cam-corner cam-tl" aria-hidden="true" />
        <span className="cam-corner cam-tr" aria-hidden="true" />
        <span className="cam-corner cam-bl" aria-hidden="true" />
        <span className="cam-corner cam-br" aria-hidden="true" />
        <span className="cam-rec-label" aria-hidden="true">● Rec</span>

        <Wordmark tone="light" />
        <CameraArt />
        <div className="cam-slot">
          <h1 className="cam-caption">Lights. <span className="italic-accent">Camera.</span></h1>
          {/* the calls of a take, one after another (timed in globals.css) */}
          <p className="cam-cues" aria-live="polite">
            {rolling && <>
              <span className="cue cue-1">Roll sound</span>
              <span className="cue cue-2">Sound speed</span>
              <span className="cue cue-3"><i className="cue-dot" aria-hidden="true" />Rolling</span>
            </>}
          </p>
        </div>
        <button type="button" className="rec-btn" onClick={onRecord} disabled={rolling} autoFocus
          aria-label="Record — open the sign-in slate">
          <span className="rec-dot" aria-hidden="true" />
          {rolling ? "Rolling" : "Record"}
        </button>
      </div>
      <div className="cam-flash" aria-hidden="true" />
    </div>
  );
}

/** A 1920s hand-cranked film camera in profile: twin reels, crank, REC lamp, lens and tripod. */
function CameraArt() {
  const reelHoles = (cx: number, cy: number, r: number) =>
    [0, 72, 144, 216, 288].map((deg) => {
      const a = (deg * Math.PI) / 180;
      return <circle key={deg} cx={cx + Math.cos(a) * r} cy={cy + Math.sin(a) * r} r={r * 0.36} fill="#0e0d0c" />;
    });
  return (
    <svg className="cam" viewBox="0 0 360 290" aria-hidden="true">
      <defs>
        <linearGradient id="cam-body" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#34312c" />
          <stop offset="1" stopColor="#141311" />
        </linearGradient>
        <radialGradient id="cam-glass" cx=".35" cy=".32" r=".8">
          <stop offset="0" stopColor="#cfe8ff" />
          <stop offset=".35" stopColor="#3d6a94" />
          <stop offset="1" stopColor="#090d12" />
        </radialGradient>
        <linearGradient id="cam-beam" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#fff6dc" stopOpacity=".95" />
          <stop offset=".6" stopColor="#ffd9a0" stopOpacity=".3" />
          <stop offset="1" stopColor="#ffd9a0" stopOpacity="0" />
        </linearGradient>
      </defs>

      {/* light thrown from the lens — invisible until the camera rolls */}
      <path className="cam-beam" d="M334 156 L 760 40 L 760 320 L 334 204 Z" fill="url(#cam-beam)" />

      {/* tripod */}
      <g stroke="#3d3a34" strokeWidth="7" strokeLinecap="round">
        <line x1="158" y1="236" x2="92" y2="284" />
        <line x1="165" y1="236" x2="165" y2="286" />
        <line x1="172" y1="236" x2="238" y2="284" />
      </g>
      <rect x="134" y="226" width="62" height="16" rx="4" fill="#26241f" stroke="#3d3a34" strokeWidth="2" />

      {/* film magazine: the two reels and the housing between them */}
      <path d="M96 122 C 130 104, 196 104, 232 122 L 226 134 L 102 134 Z" fill="#1d1c19" stroke="#3d3a34" strokeWidth="2" />
      <g className="cam-reel cam-reel-a">
        <circle cx="110" cy="76" r="56" fill="#1c1b18" stroke="#f7f1e4" strokeOpacity=".85" strokeWidth="3" />
        <circle cx="110" cy="76" r="45" fill="none" stroke="#3d3a34" strokeWidth="2" />
        {reelHoles(110, 76, 27)}
        <circle cx="110" cy="76" r="9" fill="#ef4b23" />
      </g>
      <g className="cam-reel cam-reel-b">
        <circle cx="216" cy="82" r="48" fill="#1c1b18" stroke="#f7f1e4" strokeOpacity=".85" strokeWidth="3" />
        <circle cx="216" cy="82" r="38" fill="none" stroke="#3d3a34" strokeWidth="2" />
        {reelHoles(216, 82, 23)}
        <circle cx="216" cy="82" r="8" fill="#ef4b23" />
      </g>

      {/* body */}
      <rect x="70" y="128" width="192" height="104" rx="12" fill="url(#cam-body)" stroke="#3d3a34" strokeWidth="2" />
      <rect x="70" y="203" width="192" height="7" fill="#ef4b23" />
      <rect x="48" y="146" width="26" height="32" rx="5" fill="#26241f" stroke="#3d3a34" strokeWidth="2" />
      <circle className="cam-lamp" cx="94" cy="148" r="6" fill="#4a1f19" />
      <text x="106" y="152" fontSize="10" fontWeight="700" letterSpacing="2" fill="#f7f1e4" opacity=".6">REC</text>

      {/* the hand crank */}
      <g className="cam-crank">
        <circle cx="162" cy="172" r="21" fill="#1c1b18" stroke="#f7f1e4" strokeOpacity=".45" strokeWidth="2" />
        <line x1="162" y1="172" x2="162" y2="155" stroke="#f7f1e4" strokeWidth="4" strokeLinecap="round" />
        <circle cx="162" cy="153" r="4.5" fill="#f7f1e4" />
        <circle cx="162" cy="172" r="4.5" fill="#ef4b23" />
      </g>

      {/* lens barrel, hood and glass */}
      <rect x="260" y="150" width="26" height="60" rx="4" fill="#26241f" stroke="#3d3a34" strokeWidth="2" />
      <rect x="284" y="143" width="20" height="74" rx="4" fill="#1c1b18" stroke="#3d3a34" strokeWidth="2" />
      <path d="M302 141 L 334 125 L 334 235 L 302 219 Z" fill="#141311" stroke="#3d3a34" strokeWidth="2" />
      <ellipse className="cam-glass" cx="333" cy="180" rx="9" ry="54" fill="url(#cam-glass)" />
    </svg>
  );
}
