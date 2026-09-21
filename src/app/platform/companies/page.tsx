import Link from "next/link";
import { getPlatformDb } from "@/server/db/client";
import { requirePlatformPageSession } from "@/server/lib/page-session";
import { listCompanies, listPlans } from "@/server/modules/platform/service";
import { ActionForm } from "@/components/action-form";
import { fmtDate, PageHeader } from "@/components/ui";

/** Company + subscription states share the workflow badge palette so the console reads like the rest of the app. */
const STATUS_BADGE: Record<string, string> = {
  ACTIVE: "b-approved", TRIAL: "b-review", SUSPENDED: "b-rejected",
  EXPIRED: "b-rejected", CANCELLED: "b-hold", PENDING: "b-new",
};
const Badge = ({ value }: { value: string | null | undefined }) =>
  value
    ? <span className={"badge " + (STATUS_BADGE[value] ?? "b-new")}>{value.replaceAll("_", " ")}</span>
    : <span className="muted">&mdash;</span>;

export default async function CompaniesPage() {
  const { actor } = await requirePlatformPageSession();
  const db = getPlatformDb();
  const [companies, plans] = await Promise.all([listCompanies(db, actor), listPlans(db, actor)]);
  return (
    <>
      <PageHeader title="Companies" subtitle="Each company is a separate, isolated workspace." />
      <ActionForm endpoint="/api/v1/platform/companies" title="+ New company" submitLabel="Create company and invite admin" collapsed after="result"
        description="Creates the workspace with default roles, workflow and lists, then invites the first Company Admin. Copy the invitation link shown after creating and send it privately; it works once and expires in 72 hours. Set a temporary password below instead if you'd rather skip the invitation link (e.g. no email provider configured) — the admin signs in with it directly and is forced to change it on first login."
        fields={[
          { name: "name", label: "Company name", type: "text", required: true },
          { name: "code", label: "Company code", type: "text", required: true, hint: "2–12 capitals/digits, e.g. TAM. Used in pitch codes." },
          { name: "planKey", label: "Plan", type: "select", required: true, options: plans.filter((p) => p.active).map((p) => ({ value: p.key, label: p.name })) },
          { name: "subscriptionStatus", label: "Start as", type: "select", defaultValue: "TRIAL", options: [{ value: "TRIAL", label: "Trial" }, { value: "ACTIVE", label: "Active" }] },
          { name: "endsOn", label: "Subscription ends on", type: "date" },
          { name: "adminFullName", label: "Company Admin full name", type: "text", required: true },
          { name: "adminEmail", label: "Company Admin email", type: "email", required: true },
          { name: "adminTempPassword", label: "Company Admin temp password", type: "password", hint: "Optional — leave blank to send an invitation link instead. If set, no invitation link is created and this is shown once below; tell the admin privately." },
          { name: "primaryEmail", label: "Company contact email", type: "email" },
          { name: "city", label: "City", type: "text" },
          { name: "country", label: "Country", type: "text" },
        ]} />
      <div className="table-wrap"><table className="data">
        <thead><tr><th>Company</th><th>Code</th><th>Status</th><th>Plan</th><th>Subscription</th><th>Users (active / invited)</th><th>Pitches</th><th>Storage</th><th>Created</th><th></th></tr></thead>
        <tbody>{companies.map((c) => (
          <tr key={c.id}>
            <td><Link href={`/platform/companies/${c.id}`}>{c.name}</Link></td>
            <td><code className="tag-code">{c.code}</code></td>
            <td><Badge value={c.status} /></td>
            <td>{c.planKey ? <code className="tag-code">{c.planKey}</code> : <span className="muted">&mdash;</span>}</td>
            <td><Badge value={c.subscriptionStatus} />{c.endsOn ? <div className="muted">ends {fmtDate(c.endsOn)}</div> : null}</td>
            <td>{c.usage ? `${c.usage.usersActive} / ${c.usage.usersInvited}` : "—"}</td><td>{c.usage?.pitches ?? "—"}</td>
            <td>{c.usage ? `${(c.usage.storageBytes / 1024 ** 2).toFixed(1)} MB` : "—"}</td><td>{fmtDate(c.createdAt)}</td>
            <td><Link href={`/platform/companies/${c.id}`}>Edit</Link></td>
          </tr>
        ))}</tbody>
      </table></div>
    </>
  );
}
