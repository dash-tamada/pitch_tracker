import Link from "next/link";
import { fmtDate, StageBadge, Stars } from "./ui";

/**
 * A pitch in the grid view, dressed as a film poster: a duotone "one-sheet" panel with the
 * story's initial set huge behind sprocket strips, then the facts, then an orange slip that
 * slides up on hover.
 *
 * The colourway is derived from the pitch id so a story always wears the same jacket. The CSP
 * forbids inline styles (`style-src 'self'`), so the hue is chosen as one of a fixed set of
 * classes rather than passed down as a custom property.
 */
const VARIANTS = 6;

export function posterVariant(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) { h ^= seed.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0) % VARIANTS;
}

export type PosterPitch = {
  id: string;
  title: string;
  pitchCode: string;
  creatorName: string;
  creatorRole: string;
  stageBadge: string | null | undefined;
  stageLabel: string;
  genre: string;
  format: string;
  language: string;
  ownerName: string | null;
  avgRating: number | null | undefined;
  daysWaiting: number;
  updatedAt: Date | string;
  priority: string;
};

export function PitchPoster({ p }: { p: PosterPitch }) {
  const initial = p.title.trim().charAt(0).toUpperCase() || "?";
  const hot = p.priority === "HIGH" || p.priority === "URGENT";
  return (
    <Link className="poster" href={`/pitches/${p.id}`}>
      <div className={`poster-art pv-${posterVariant(p.id)}`}>
        <span className="poster-initial" aria-hidden="true">{initial}</span>
        <span className="poster-code">{p.pitchCode}</span>
        {hot && <span className="poster-flag">{p.priority}</span>}
      </div>
      <div className="poster-body">
        <h3>{p.title}</h3>
        <p className="poster-by">{p.creatorName} <span className="muted">· {p.creatorRole}</span></p>
        <div className="poster-tags"><StageBadge badge={p.stageBadge} label={p.stageLabel} /></div>
        <dl className="poster-facts">
          <dt>Genre</dt><dd>{p.genre}</dd>
          <dt>Format</dt><dd>{p.format} · {p.language}</dd>
          <dt>With</dt><dd>{p.ownerName ?? "—"}</dd>
          <dt>Updated</dt><dd>{fmtDate(p.updatedAt)}</dd>
        </dl>
        <div className="poster-foot">
          <Stars value={p.avgRating} />
          <span className={p.daysWaiting >= 14 ? "poster-days is-late" : "poster-days"}>{p.daysWaiting}d waiting</span>
        </div>
      </div>
      <span className="poster-cta" aria-hidden="true">Open the file →</span>
    </Link>
  );
}
