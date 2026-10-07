import { connection } from "next/server";
import { CreatorLogoutButton } from "@/components/creator-logout-button";
import { WriterShell, creatorNav } from "@/components/writer-shell";
import { getPlatformDb } from "@/server/db/client";
import { requireStudio } from "@/server/lib/public-creator-page";
import { housePitches, listAcceptingHouses, listMySends } from "@/server/modules/public-creators/studio";

const date = (d: Date) => d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: "Asia/Kolkata" });

/** Production Houses: where the writer has pitched, how many pitches each has, and — for the selected house — each pitch's status and updates. */
export default async function CreatorHouses({ searchParams }: { searchParams: Promise<{ house?: string }> }) {
  await connection();
  const me = await requireStudio();
  const { house } = await searchParams;
  const db = getPlatformDb();
  const [open, sends] = await Promise.all([listAcceptingHouses(db), listMySends(db, me.creatorId)]);
  const counts = new Map<string, { name: string; n: number }>();
  for (const s of sends) counts.set(s.companyId, { name: s.company, n: (counts.get(s.companyId)?.n ?? 0) + 1 });
  const houses = new Map(open.map((h) => [h.id, { name: h.name, n: counts.get(h.id)?.n ?? 0 }]));
  for (const [id, c] of counts) if (!houses.has(id)) houses.set(id, c);
  const list = [...houses.entries()].sort((a, b) => b[1].n - a[1].n || a[1].name.localeCompare(b[1].name));
  const selected = house && houses.has(house) ? house : null;
  const pitches = selected ? await housePitches(db, me.creatorId, selected) : [];

  return (
    <WriterShell area="Creator studio" nav={creatorNav("houses")} actions={<CreatorLogoutButton />}>
      <div className="page-head"><div><h1 className="page-title">Production houses</h1>
        <p className="subtle">Pick a production house to see the pitches you sent it and how each one is going.</p></div></div>
      {list.length === 0 ? <p className="empty">No production house is accepting pitches right now.</p> : (
        <div className="house-grid">
          {list.map(([id, h]) => (
            <a key={id} className="house-card" href={`/creator/houses?house=${id}`} aria-current={id === selected ? "true" : undefined}>
              <strong>{h.name}</strong>
              <span className="muted">{h.n === 0 ? "No pitches sent yet" : `${h.n} pitch${h.n === 1 ? "" : "es"} sent`}</span>
            </a>
          ))}
        </div>
      )}
      {selected && (
        <div className="section">
          <h2>{houses.get(selected)!.name}</h2>
          {pitches.length === 0 ? <p className="empty">You have not pitched anything here yet. Open a pitch and use “Pitch to”.</p> : (
            <table className="data"><thead><tr><th>Pitch</th><th>Status</th><th>Sent</th></tr></thead><tbody>
              {pitches.map((p) => (
                <tr key={p.sendId}>
                  <td><a href={`/creator/drafts/${p.draftId}`}>{p.title}</a>
                    {p.history.length > 0 && <ul className="timeline">{p.history.map((h, i) => <li key={i}>{h.status} · {date(h.at)}</li>)}</ul>}</td>
                  <td>{p.status ? <span className="badge b-new">{p.status}</span> : <span className="muted">—</span>}{p.updatedAt && <div className="muted">since {date(p.updatedAt)}</div>}</td>
                  <td className="nowrap muted">{date(p.sentAt)}</td>
                </tr>
              ))}
            </tbody></table>
          )}
        </div>
      )}
    </WriterShell>
  );
}
