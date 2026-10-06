"use client";

import { useEffect, useState } from "react";
import { loadTake, newTake, saveTake, timecode, type Take } from "./viewfinder";

/**
 * The camera-monitor overlay on the dashboard: a thin frame with corner handles, a settings bar along the top, a status bar
 * along the bottom, a blinking REC light and a running timecode. The settings are random per login (see viewfinder.ts).
 * It never takes pointer events, and is drawn entirely with classes because the CSP forbids inline styles.
 */
export function ViewfinderHud() {
  const [t, setT] = useState<Take | null>(null);
  const [tc, setTc] = useState("--:--:--:--");

  useEffect(() => {
    let cur = loadTake();
    if (!cur) { cur = newTake(); saveTake(cur); }
    setT(cur);
  }, []);

  useEffect(() => {
    if (!t) return;
    const fps = Number(t.fps);
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
    const began = performance.now();
    const tick = () => setTc(timecode(t.startSeconds, ((performance.now() - began) / 1000) * fps, fps));
    tick();
    const id = window.setInterval(tick, reduced ? 1000 : Math.round(1000 / fps));
    return () => window.clearInterval(id);
  }, [t]);

  if (!t) return null;
  return (
    <div className="vf" aria-hidden="true">
      <div className="vf-frame">
        {["tl", "tr", "bl", "br", "tm", "bm", "ml", "mr"].map((p) => <span key={p} className={`vf-h vf-h-${p}`} />)}
        <span className="vf-cross" />
      </div>
      <div className="vf-bar vf-top">
        <span>FPS <b>{t.fps}</b></span>
        <span>SHUTTER <b>{t.shutter}</b></span>
        <span>IRIS <b>{t.iris}</b> 0/10</span>
        <span>EI <b>{t.ei}</b></span>
        <span>ND <b>{t.nd}</b></span>
        <span>WB <b>{t.wb}</b> <b>{t.cc}</b></span>
        <span className="vf-side">{t.side}</span>
      </div>
      <div className="vf-bar vf-bottom">
        <span>FCL <b>{t.fcl}</b></span>
        <span>BAT <b>{t.bat}</b></span>
        <span><b>{t.cam}</b> <b>{t.clip}</b></span>
        <span className="vf-tilt">ROLL <b>{t.roll}</b> TILT <b>{t.tilt}</b></span>
        <span className="vf-rec"><i className="vf-dot" /> REC</span>
        <span>MEDIA <b>{t.media}</b></span>
        <span>TC <b>{tc}</b></span>
      </div>
    </div>
  );
}
