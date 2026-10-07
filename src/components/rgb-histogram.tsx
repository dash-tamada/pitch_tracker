"use client";

import { useEffect, useRef } from "react";
import { BINS, normalise, sampleScreen, type Bins } from "./screen-histogram";

/**
 * The live RGB colour histogram on the right edge of every signed-in page, like a camera monitor's scope.
 *
 * It started life inside the full camera overlay; the overlay's frame, settings bars and timecode were removed in the
 * UI refinement pass, and the histogram was kept on its own, drawn and behaving exactly as before: re-sampled whenever
 * the page scrolls or changes (at most ~7 times a second, plus a slow poll for changes without scrolling), eased towards
 * its new shape, and never taking pointer events. Drawn on a canvas because the CSP forbids inline styles.
 */
export function RgbHistogram() {
  const histRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = histRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const W = 56, H = 180, TOP = 6, BOTTOM = 18, rowH = (H - TOP - BOTTOM) / BINS;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = W * dpr; canvas.height = H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const zero = (): Bins => ({ r: new Array(BINS).fill(0), g: new Array(BINS).fill(0), b: new Array(BINS).fill(0) });
    let cur = zero(), target = zero(), raf = 0, timer = 0, lastRun = 0;
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;

    const paint = () => {
      ctx.globalCompositeOperation = "source-over";
      ctx.clearRect(0, 0, W, H);
      ctx.fillStyle = "rgba(14,13,12,.55)";
      ctx.fillRect(0, 0, W, H);
      ctx.globalCompositeOperation = "lighter"; // where the channels overlap the bars add up towards white, as on a real scope
      const channels: [number[], string][] = [[cur.r, "rgba(255,52,40,.85)"], [cur.g, "rgba(40,230,90,.85)"], [cur.b, "rgba(60,110,255,.9)"]];
      for (const [vals, colour] of channels) {
        ctx.fillStyle = colour;
        for (let i = 0; i < BINS; i++) {
          const w = (W - 8) * vals[i]!;
          if (w > 0.4) ctx.fillRect(W - 4 - w, TOP + (BINS - 1 - i) * rowH, w, Math.max(1, rowH - 1)); // brightest at the top
        }
      }
      ctx.globalCompositeOperation = "source-over";
      ctx.fillStyle = "rgba(233,230,223,.7)";
      ctx.font = "600 9px ui-monospace, Menlo, Consolas, monospace";
      ctx.fillText("RGB", 6, H - 6);
    };

    const ease = () => {
      let moving = false;
      for (const k of ["r", "g", "b"] as const) {
        for (let i = 0; i < BINS; i++) {
          const d = target[k][i]! - cur[k][i]!;
          if (Math.abs(d) > 0.004) { cur[k][i]! += d * (reduced ? 1 : 0.22); moving = true; } else cur[k][i] = target[k][i]!;
        }
      }
      paint();
      raf = moving ? requestAnimationFrame(ease) : 0;
    };

    const resample = () => {
      timer = 0; lastRun = performance.now();
      if (document.hidden) return;
      target = normalise(sampleScreen());
      if (!raf) raf = requestAnimationFrame(ease);
    };
    const schedule = () => {
      if (timer) return;
      timer = window.setTimeout(resample, Math.max(0, 140 - (performance.now() - lastRun))); // at most ~7 samples a second while scrolling
    };

    paint();
    schedule();
    window.addEventListener("scroll", schedule, { passive: true, capture: true });
    window.addEventListener("resize", schedule);
    const poll = window.setInterval(schedule, 1500); // pages that change without scrolling (route changes, images arriving)
    return () => {
      window.removeEventListener("scroll", schedule, true);
      window.removeEventListener("resize", schedule);
      window.clearInterval(poll); window.clearTimeout(timer); cancelAnimationFrame(raf);
    };
  }, []);

  return <canvas ref={histRef} className="vf-hist" aria-hidden="true" />;
}
