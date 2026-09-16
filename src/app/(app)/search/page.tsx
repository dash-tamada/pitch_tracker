import Link from "next/link";
import { getDb } from "@/server/db/client";
import { AppError } from "@/server/lib/errors";
import { requirePageSession } from "@/server/lib/page-session";
import { globalSearch } from "@/server/modules/search/service";
import { PLATFORM_STATUS_LABEL, typeLabel } from "@/components/labels";
import { Empty, PageHeader, StageBadge } from "@/components/ui";

export default async function SearchPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { actor } = await requirePageSession();
  const q = ((await searchParams).q ?? "").trim();
  let r: Awaited<ReturnType<typeof globalSearch>> | null = null;
  let error: string | null = null;
  if (q) {
    try { r = await globalSearch(getDb(actor), actor, { q }); } catch (e) { if (e instanceof AppError) error = "Type at least 2 characters."; else throw e; }
  }
  const nothing = r && !r.pitches.length && !r.creators.length && !r.platforms.length && !r.people.length;
  return (
    <>
      <PageHeader title={q ? `Search: ${q}` : "Search"} subtitle="Results only include what you are allowed to see." />
      {error && <p className="notice">{error}</p>}
      {nothing && <Empty>No results.</Empty>}
      {r && r.creators.length > 0 && <section className="section"><h2>Creators</h2><table className="data"><tbody>{r.creators.map((c) => <tr key={c.id}><td><Link href={`/creators/${c.id}`}>{c.fullName}</Link></td><td>{typeLabel(c.creatorType)}</td><td>{c.mobile ?? ""}</td><td><Link href={`/pitches?q=${encodeURIComponent(c.fullName)}`}>Pitches</Link> · <Link href={`/creators/${c.id}?tab=projects`}>Projects</Link></td></tr>)}</tbody></table></section>}
      {r && r.pitches.length > 0 && <section className="section"><h2>Pitches</h2><table className="data"><tbody>{r.pitches.map((p) => <tr key={p.id}><td><Link href={`/pitches/${p.id}`}>{p.title}</Link><div className="muted">{p.pitchCode}</div></td><td>{p.creatorName}</td><td><StageBadge badge={p.badge} label={p.stageName ?? ""} /></td><td>{p.ownerName ?? "—"}</td></tr>)}</tbody></table></section>}
      {r && r.platforms.length > 0 && <section className="section"><h2>Platforms</h2><table className="data"><tbody>{r.platforms.map((p) => <tr key={p.id}><td><Link href={`/platforms/${p.id}`}>{p.name}</Link></td><td>{p.pending} awaiting response</td></tr>)}</tbody></table>
        {r.platformPitches.length > 0 && <><h3>Pitches with these platforms</h3><table className="data"><tbody>{r.platformPitches.map((x, i) => <tr key={i}><td><Link href={`/pitches/${x.pitchId}?tab=platforms`}>{x.title}</Link></td><td>{x.platform}</td><td>{PLATFORM_STATUS_LABEL[x.status]}</td></tr>)}</tbody></table></>}</section>}
      {r && r.people.length > 0 && <section className="section"><h2>People</h2><table className="data"><tbody>{r.people.map((u) => <tr key={u.id}><td>{u.fullName}</td><td><Link href={`/pitches?ownerId=${u.id}`}>Pitches with {u.fullName}</Link></td></tr>)}</tbody></table></section>}
    </>
  );
}
