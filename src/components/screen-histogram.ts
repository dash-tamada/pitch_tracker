/**
 * Estimates which colours are on screen right now, for the camera overlay's histogram.
 *
 * A web page cannot read its own pixels, so this samples a grid of points across the viewport and works out what is
 * visibly there: at each point it stacks the elements under it (topmost first) and blends their backgrounds until the
 * result is opaque. Images — including CSS background images such as the dashboard artwork — are read through a small
 * cached thumbnail, so a photograph contributes its real colours. Gradients and text are not sampled. Only same-origin
 * images can be read; anything else is skipped rather than failing.
 */
export const BINS = 24;
export interface Bins { r: number[]; g: number[]; b: number[] }

const COLS = 20;
const ROWS = 12;
const THUMB = 24;
const PAGE_BG = [11, 8, 7]; // #0b0807, what shows through when nothing is in the way

const thumbs = new Map<string, ImageData | null | "loading">();

/** A 24×24 thumbnail of a same-origin image, or null while it loads or when it cannot be read. */
function thumbFor(src: string): ImageData | null {
  const hit = thumbs.get(src);
  if (hit === "loading") return null;
  if (hit !== undefined) return hit;
  let sameOrigin = false;
  try { sameOrigin = new URL(src, window.location.href).origin === window.location.origin; } catch { /* bad url */ }
  if (!sameOrigin) { thumbs.set(src, null); return null; }
  thumbs.set(src, "loading");
  const img = new Image();
  img.decoding = "async";
  img.onload = () => {
    try {
      const c = document.createElement("canvas");
      c.width = THUMB; c.height = THUMB;
      const g = c.getContext("2d", { willReadFrequently: true });
      if (!g) { thumbs.set(src, null); return; }
      g.drawImage(img, 0, 0, THUMB, THUMB);
      thumbs.set(src, g.getImageData(0, 0, THUMB, THUMB));
    } catch { thumbs.set(src, null); }
  };
  img.onerror = () => thumbs.set(src, null);
  img.src = src;
  return null;
}

type Layer =
  | { kind: "none" }
  | { kind: "color"; r: number; g: number; b: number; a: number }
  | { kind: "image"; src: string; left: number; top: number; width: number; height: number };

function parseRgba(s: string): { r: number; g: number; b: number; a: number } | null {
  const m = /rgba?\(\s*([\d.]+)[ ,]+([\d.]+)[ ,]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)/.exec(s);
  if (!m) return null;
  const a = m[4] === undefined ? 1 : m[4].endsWith("%") ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
  return { r: +m[1]!, g: +m[2]!, b: +m[3]!, a };
}

function layerOf(el: Element, cache: Map<Element, Layer>): Layer {
  const known = cache.get(el);
  if (known) return known;
  let out: Layer = { kind: "none" };
  if (!el.closest(".vf, .pw")) {
    if (el instanceof HTMLImageElement) {
      const r = el.getBoundingClientRect();
      out = { kind: "image", src: el.currentSrc || el.src, left: r.left, top: r.top, width: r.width, height: r.height };
    } else {
      const cs = getComputedStyle(el);
      const url = /url\(["']?([^"')]+)["']?\)/.exec(cs.backgroundImage);
      if (url && cs.visibility !== "hidden") {
        const r = el.getBoundingClientRect();
        out = { kind: "image", src: url[1]!, left: r.left, top: r.top, width: r.width, height: r.height };
      } else {
        const c = parseRgba(cs.backgroundColor);
        const alpha = c ? c.a * (parseFloat(cs.opacity) || 0) : 0;
        if (c && alpha > 0.02 && cs.visibility !== "hidden") out = { kind: "color", r: c.r, g: c.g, b: c.b, a: alpha };
      }
    }
  }
  cache.set(el, out);
  return out;
}

function colourAt(x: number, y: number, cache: Map<Element, Layer>): [number, number, number] {
  let r = 0, g = 0, b = 0, a = 0; // premultiplied, accumulated front to back
  for (const el of document.elementsFromPoint(x, y)) {
    if (a >= 0.97) break;
    const L = layerOf(el, cache);
    let lr = 0, lg = 0, lb = 0, la = 0;
    if (L.kind === "color") { lr = L.r; lg = L.g; lb = L.b; la = L.a; }
    else if (L.kind === "image") {
      const d = thumbFor(L.src);
      if (!d) continue;
      const u = Math.min(0.999, Math.max(0, (x - L.left) / Math.max(1, L.width)));
      const v = Math.min(0.999, Math.max(0, (y - L.top) / Math.max(1, L.height)));
      const i = (Math.floor(v * THUMB) * THUMB + Math.floor(u * THUMB)) * 4;
      lr = d.data[i]!; lg = d.data[i + 1]!; lb = d.data[i + 2]!; la = 1;
    } else continue;
    const k = (1 - a) * la;
    r += lr * k; g += lg * k; b += lb * k; a += k;
  }
  const rest = Math.max(0, 1 - a);
  return [r + PAGE_BG[0]! * rest, g + PAGE_BG[1]! * rest, b + PAGE_BG[2]! * rest];
}

/** Counts of the sampled points per intensity bin, for each of red, green and blue. */
export function sampleScreen(): Bins {
  const bins: Bins = { r: new Array(BINS).fill(0), g: new Array(BINS).fill(0), b: new Array(BINS).fill(0) };
  const cache = new Map<Element, Layer>();
  const w = window.innerWidth, h = window.innerHeight;
  const bin = (v: number) => Math.min(BINS - 1, Math.max(0, Math.floor((v / 256) * BINS)));
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      const [r, g, b] = colourAt(((col + 0.5) / COLS) * w, ((row + 0.5) / ROWS) * h, cache);
      bins.r[bin(r)]!++; bins.g[bin(g)]!++; bins.b[bin(b)]!++;
    }
  }
  return bins;
}

/** Bar lengths 0..1, softened so small populations still show next to a dominant one. */
export function normalise(b: Bins): Bins {
  const max = Math.max(1, ...b.r, ...b.g, ...b.b);
  const f = (a: number[]) => a.map((v) => Math.sqrt(v / max));
  return { r: f(b.r), g: f(b.g), b: f(b.b) };
}
