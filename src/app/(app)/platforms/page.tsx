import Link from "next/link";
import { getDb } from "@/server/db/client";
import { pageData, requirePageSession } from "@/server/lib/page-session";
import { can } from "@/server/modules/authz/policy";
import { getLookups } from "@/server/modules/lookups/service";
import { listPlatforms } from "@/server/modules/platforms/service";
import { ActionForm } from "@/components/action-form";
import { Empty, PageHeader } from "@/components/ui";

export default async function PlatformsPage() {
  const { actor } = await requirePageSession();
  const db = getDb(actor);
  const rows = await pageData(() => listPlatforms(db, actor, true));
  if (!rows) return <p className="notice">You do not have access to platforms.</p>;
  const lookups = await getLookups(db);
  const opts = (t: string) => (lookups[t] ?? []).map((l) => ({ value: l.key, label: l.label }));
  return (
    <>
      <PageHeader title="Platforms" subtitle="OTT and content platforms, their contacts and how our pitches are doing with each." />
      {can(actor, "platform.manage") && (
        <ActionForm endpoint="/api/v1/platforms" title="+ Add platform" submitLabel="Add platform" collapsed
          fields={[{ name: "name", label: "Name", type: "text", required: true }, { name: "kind", label: "Type", type: "select", options: ["OTT", "BROADCAST", "AVOD", "OTHER"].map((v) => ({ value: v, label: v })) },
            { name: "languageKeys", label: "Languages", type: "checkboxes", options: opts("LANGUAGE") }, { name: "genreKeys", label: "Genres", type: "checkboxes", options: opts("GENRE") },
            { name: "preferences", label: "Content preferences", type: "textarea" }, { name: "notes", label: "Notes", type: "textarea" }]} />
      )}
      {rows.length === 0 ? <Empty>No platforms.</Empty> : (
        <div className="table-wrap"><table className="data">
          <thead><tr><th>Platform</th><th>Type</th><th>Pitched</th><th>Open</th><th>Approved</th><th>Rejected</th><th>Approval rate</th><th>Status</th></tr></thead>
          <tbody>{rows.map((p) => (
            <tr key={p.id}><td><Link href={`/platforms/${p.id}`}>{p.name}</Link></td><td>{p.kind}</td><td>{p.stats.total}</td><td>{p.stats.open}</td><td>{p.stats.approved}</td><td>{p.stats.rejected}</td>
              <td>{p.stats.total ? `${Math.round((p.stats.approved / p.stats.total) * 1000) / 10}%` : "—"}</td><td>{p.active ? "Active" : "Disabled"}</td></tr>
          ))}</tbody>
        </table></div>
      )}
    </>
  );
}
