import { existsSync } from "node:fs";
import path from "node:path";

/**
 * "Legends of Telugu cinema" — a row of poster cards: the actor, a defining film and its year.
 * A portrait is shown when /public/img/legends/<slug>.jpg exists (served from 'self', as the CSP
 * requires); otherwise the card falls back to a monogram so nothing renders as a broken image.
 */
const LEGENDS = [
  { slug: "ntr", name: "N. T. Rama Rao", film: "Maya Bazaar", year: 1957, tag: "Viswa Vikhyatha Nata Sarvabhowma" },
  { slug: "anr", name: "A. Nageswara Rao", film: "Devadasu", year: 1953, tag: "Natasamrat" },
  { slug: "savitri", name: "Savitri", film: "Mayabazar", year: 1957, tag: "Mahanati" },
  { slug: "svr", name: "S. V. Ranga Rao", film: "Pathala Bhairavi", year: 1951, tag: "Viswa Nata Chakravarthi" },
  { slug: "krishna", name: "Krishna", film: "Alluri Sitarama Raju", year: 1974, tag: "Superstar" },
  { slug: "krishnam-raju", name: "Krishnam Raju", film: "Bhakta Kannappa", year: 1976, tag: "Rebel Star" },
  { slug: "sobhan-babu", name: "Sobhan Babu", film: "Manushulu Maarali", year: 1969, tag: "Sobhan Babu" },
  { slug: "chiranjeevi", name: "Chiranjeevi", film: "Indra", year: 2002, tag: "Megastar" },
];

const initials = (n: string) => n.split(/[\s.]+/).filter(Boolean).slice(-2).map((w) => w[0]).join("");

export function Legends() {
  return (
    <section className="legends" aria-labelledby="legends-h">
      <div className="legends-head">
        <h2 id="legends-h">Legends of Telugu cinema</h2>
        <p className="subtle">The stories we are pitching stand on their shoulders.</p>
      </div>
      <ul className="legend-row">
        {LEGENDS.map((l, i) => {
          const hasPhoto = existsSync(path.join(process.cwd(), "public", "img", "legends", `${l.slug}.jpg`));
          return (
            <li key={l.slug} className={`legend tone-${(i % 6) + 1}`}>
              <div className="legend-photo">
                {hasPhoto
                  // eslint-disable-next-line @next/next/no-img-element -- small static portrait from /public
                  ? <img src={`/img/legends/${l.slug}.jpg`} alt={l.name} loading="lazy" />
                  : <span className="legend-mono" aria-hidden="true">{initials(l.name)}</span>}
              </div>
              <div className="legend-body">
                <div className="legend-tag">{l.tag}</div>
                <div className="legend-name">{l.name}</div>
                <div className="legend-film">🎬 {l.film} <span>· {l.year}</span></div>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
