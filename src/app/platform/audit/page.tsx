import Link from "next/link";
import { getPlatformDb } from "@/server/db/client";
import { requirePlatformPageSession } from "@/server/lib/page-session";
import { platformAudit } from "@/server/modules/platform/service";
import { fmtDateTime, PageHeader } from "@/components/ui";

export default async function PlatformAuditPage({ searchParams }: { searchParams: Promise<{ action?: string; cursor?: string }> }) {
  const { actor } = await requirePlatformPageSession();
  const sp = await searchParams;
  const action = sp.action && /^[a-z_.]{1,80}$/.test(sp.action) ? sp.action : undefined;
  const page = await platformAudit(getPlatformDb(), actor, { ...(action ? { action } : {}), ...(sp.cursor ? { cursor: sp.cursor } : {}) });
  return (
    <>
      <PageHeader title="Platform audit" subtitle="Sign-in, security, company, subscription and support events. Company business events stay in each company's own audit log." />
      <form method="get" className="row-actions"><input name="action" placeholder="Filter e.g. auth. or company." defaultValue={action} /><button className="btn-secondary">Filter</button></form>
      <div className="table-wrap"><table className="data">
        <thead><tr><th>When</th><th>Event</th><th>Company</th><th>By</th><th>Details</th></tr></thead>
        <tbody>{page.items.map((i) => (
          <tr key={i.id}><td>{fmtDateTime(i.createdAt)}</td><td>{i.action}</td><td>{i.companyCode ?? "Platform"}</td><td>{i.actorEmail ?? "—"}</td><td>{i.after ? <code>{JSON.stringify(i.after).slice(0, 160)}</code> : <span className="muted">&mdash;</span>}</td></tr>
        ))}</tbody>
      </table></div>
      {page.nextCursor && <Link href={`/platform/audit?${new URLSearchParams({ ...(action ? { action } : {}), cursor: page.nextCursor })}`}>Older →</Link>}
    </>
  );
}
