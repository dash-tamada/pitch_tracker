/**
 * The wall of old film posters scrolling behind the sign-in page.
 *
 * Four marquee rows run in alternating directions at different speeds. Each row renders its posters
 * twice and the track slides by exactly half its width, so the end of one copy meets the start of the
 * next and the loop has no visible seam. Width/height attributes reserve each poster's shape before it
 * loads, so the track never jumps as images arrive.
 *
 * Every poster is a classic Telugu film poster from 1933–1961, in the public domain in India (films and
 * their publicity material are protected for 60 years from publication); sources: docs/poster-credits.md.
 * Served from /public because the CSP is `img-src 'self'`. Purely decorative: hidden from assistive tech.
 */
type Poster = { slug: string; film: string; w: number; h: number };

const POSTERS: Poster[] = [
  { slug: "mayabazar-1936", film: "Mayabazar", w: 260, h: 377 },
  { slug: "donga-ramudu-1955", film: "Donga Ramudu", w: 260, h: 373 },
  { slug: "chenchu-lakshmi-1943", film: "Chenchu Lakshmi", w: 260, h: 431 },
  { slug: "iddaru-mitrulu-1961", film: "Iddaru Mitrulu", w: 260, h: 367 },
  { slug: "sati-savithri-1933", film: "Sati Savithri", w: 260, h: 447 },
  { slug: "devadasu-1953", film: "Devadasu", w: 260, h: 359 },
  { slug: "mallipelli-1939", film: "Mallipelli", w: 260, h: 374 },
  { slug: "amarajeevi-1956", film: "Amarajeevi", w: 260, h: 384 },
  { slug: "palnati-yuddham-1947", film: "Palnati Yuddham", w: 260, h: 410 },
  { slug: "srikrishna-rayabaramu-1960", film: "Srikrishna Rayabaramu", w: 260, h: 343 },
  { slug: "sri-krishna-tulabharam-1935", film: "Sri Krishna Tulabharam", w: 260, h: 344 },
  { slug: "pasupu-kumkuma-1955", film: "Pasupu Kumkuma", w: 260, h: 387 },
  { slug: "viswa-mohini-1940", film: "Viswa Mohini", w: 260, h: 396 },
  { slug: "veera-simha-1959", film: "Veera Simha", w: 260, h: 358 },
  { slug: "droupadi-vastrapaharanam-1936", film: "Droupadi Vastrapaharanam", w: 260, h: 402 },
  { slug: "jyoti-1954", film: "Jyoti", w: 260, h: 398 },
  { slug: "dakshayagnam-1941", film: "Dakshayagnam", w: 239, h: 448 },
  { slug: "karmika-vijayam-1960", film: "Karmika Vijayam", w: 260, h: 402 },
  { slug: "mohini-bhasmasura-1938", film: "Mohini Bhasmasura", w: 260, h: 437 },
  { slug: "pelli-kooturu-1951", film: "Pelli Kooturu", w: 260, h: 368 },
  { slug: "brahmaratham-1947", film: "Brahmaratham", w: 260, h: 329 },
  { slug: "manorama-1959", film: "Manorama", w: 260, h: 365 },
  { slug: "sarangadhara-1937", film: "Sarangadhara", w: 260, h: 358 },
  { slug: "santi-1952", film: "Santi", w: 260, h: 346 },
  { slug: "apavadu-1941", film: "Apavadu", w: 260, h: 405 },
  { slug: "swayam-prabha-1957", film: "Swayam Prabha", w: 260, h: 402 },
  { slug: "gulebakavali-1938", film: "Gulebakavali", w: 260, h: 398 },
  { slug: "aalu-magalu-1959", film: "Aalu Magalu", w: 260, h: 367 },
  { slug: "mahi-ravana-1940", film: "Mahi Ravana", w: 260, h: 414 },
  { slug: "sarvadhikari-1951", film: "Sarvadhikari", w: 260, h: 386 },
  { slug: "sati-tulasi-1936", film: "Sati Tulasi", w: 260, h: 341 },
  { slug: "vegu-chukka-1957", film: "Vegu Chukka", w: 260, h: 381 },
  { slug: "malathi-madhavam-1940", film: "Malathi Madhavam", w: 260, h: 388 },
  { slug: "daiva-balam-1959", film: "Daiva Balam", w: 260, h: 348 },
];

/** Each row starts at a different point in the list, so no two rows show the same poster side by side. */
const rotate = (by: number) => [...POSTERS.slice(by), ...POSTERS.slice(0, by)];
// Four rows: the wall is tilted, so it needs extra height to still reach every corner of a tall screen.
const ROWS = [rotate(0), rotate(11).reverse(), rotate(22), rotate(6).reverse()];

function Row({ posters, n }: { posters: Poster[]; n: number }) {
  return (
    <div className={`pw-row pw-row-${n}`}>
      <div className="pw-track">
        {[0, 1].map((copy) => posters.map((p) => (
          <img key={`${copy}-${p.slug}`} className="pw-poster" src={`/img/posters/${p.slug}.jpg`}
            width={p.w} height={p.h} alt="" decoding="async" />
        )))}
      </div>
    </div>
  );
}

/**
 * The same classic posters as a dimmed, slowly drifting backdrop for the signed-in app: three tilted rows sliding in alternating
 * directions exactly like the sign-in wall (each row holds its posters twice so the loop has no seam), drawn once behind every
 * page. The shade is heavy so the posters read as texture and never fight the content; reduced motion stops the drift.
 */
export function PosterBackdrop() {
  const rows = [0, 11, 22].map((by) => rotate(by).concat(rotate(by + 5)).slice(0, 16));
  return (
    <div className="pw pw-app" aria-hidden="true">
      <div className="pw-tilt">
        {rows.map((posters, i) => (
          <div key={i} className={`pw-row pw-row-${i + 1}`}>
            <div className="pw-track">
              {[0, 1].map((copy) => posters.map((p, k) => (
                <img key={`${copy}-${k}-${p.slug}`} className="pw-poster" src={`/img/posters/${p.slug}.jpg`} width={p.w} height={p.h} alt="" decoding="async" loading="lazy" />
              )))}
            </div>
          </div>
        ))}
      </div>
      <div className="pw-shade" />
    </div>
  );
}

export function PosterWall() {
  return (
    <div className="pw" aria-hidden="true">
      <div className="pw-tilt">
        {ROWS.map((posters, i) => <Row key={i} posters={posters} n={i + 1} />)}
      </div>
      <div className="pw-shade" />
      <div className="pw-grain" />
    </div>
  );
}
