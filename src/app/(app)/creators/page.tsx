import Link from "next/link";
import { getDb } from "@/server/db/client";
import { pageData, requirePageSession } from "@/server/lib/page-session";
import { can } from "@/server/modules/authz/policy";
import { listCreators } from "@/server/modules/creators/service";
import { Empty, fmtDate, PageHeader } from "@/components/ui";
import { CrewCard } from "@/components/crew-card";
import { typeLabel } from "@/components/labels";

const TYPES: [string, string][] = [["", "All types"], ["WRITER", "Writer"], ["DIRECTOR", "Director"], ["WRITER_DIRECTOR", "Writer + Director"], ["PRODUCER", "Producer"], ["CREATOR", "Creator"], ["OTHER", "Other"]];

export default async function CreatorsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { actor } = await requirePageSession();
  const sp = await searchParams;
  const query = Object.fromEntries(Object.entries({ q: sp.q, type: sp.type, cursor: sp.cursor }).filter(([, v]) => v));
  const page = await pageData(() => listCreators(getDb(actor), actor, query));
  if (!page) return <p className="notice">You do not have access to creators.</p>;

  const next = page.nextCursor ? `?${new URLSearchParams({ ...query, cursor: page.nextCursor }).toString()}` : null;
  return (
    <>
      <PageHeader title="Creators" subtitle="Writers, directors and producers who have pitched to us."
        actions={can(actor, "creator.create") ? <Link className="btn-inline" href="/creators/new">+ New creator</Link> : undefined} />
      <form className="filters" method="get">
        <label className="field">Search<input name="q" defaultValue={sp.q ?? ""} placeholder="Name or mobile number" /></label>
        <label className="field">Type<select name="type" defaultValue={sp.type ?? ""}>{TYPES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
        <button className="btn-secondary">Search</button>
      </form>
      {page.items.length === 0 ? <Empty>No creators found.</Empty> : (
        <div className="crew-grid">
          {page.items.map((c) => (
            <CrewCard key={c.id} c={{
              id: c.id, fullName: c.fullName, role: typeLabel(c.creatorType),
              mobile: c.mobile, location: c.location, createdAt: c.createdAt,
            }} />
          ))}
        </div>
      )}
      {next && <div className="pager"><Link className="btn-secondary" href={next}>Next page →</Link></div>}
    </>
  );
}
