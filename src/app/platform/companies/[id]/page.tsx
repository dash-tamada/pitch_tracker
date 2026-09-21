import Link from "next/link";
import { getPlatformDb } from "@/server/db/client";
import { uuidParam } from "@/server/lib/http";
import { pageData, requirePlatformPageSession } from "@/server/lib/page-session";
import { getCompany, listPlans } from "@/server/modules/platform/service";
import { ActionForm } from "@/components/action-form";
import { SupportPanel } from "@/components/support-panel";
import { Empty, fmtDate, fmtDateTime, PageHeader, Stat } from "@/components/ui";

const STATUS = ["TRIAL", "ACTIVE", "SUSPENDED", "EXPIRED", "ARCHIVED"].map((s) => ({ value: s, label: s }));
const SUB = ["TRIAL", "ACTIVE", "PAST_DUE", "SUSPENDED", "EXPIRED", "CANCELLED"].map((s) => ({ value: s, label: s.replaceAll("_", " ") }));

/** Company, subscription and user states share the workflow badge palette used across the app. */
const STATUS_BADGE: Record<string, string> = {
  ACTIVE: "b-approved", TRIAL: "b-review", PAST_DUE: "b-review", SUSPENDED: "b-rejected",
  EXPIRED: "b-rejected", CANCELLED: "b-hold", ARCHIVED: "b-hold", INVITED: "b-new", DISABLED: "b-hold",
};
const Badge = ({ value }: { value: string | null | undefined }) =>
  value
    ? <span className={"badge " + (STATUS_BADGE[value] ?? "b-new")}>{value.replaceAll("_", " ")}</span>
    : <span className="muted">&mdash;</span>;

const n = (v: unknown) => Number(v ?? 0);

export default async function CompanyDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { actor } = await requirePlatformPageSession();
  const { id } = await params;
  const db = getPlatformDb();
  const d = await pageData(() => getCompany(db, actor, uuidParam(id, "Company")));
  if (!d) return <p className="notice">Not available.</p>;
  const plans = await listPlans(db, actor);
  const c = d.company;
  const u = d.usage;
  const overrides = (d.subscription?.limitOverrides ?? {}) as Record<string, number | null>;
  const activeGrant = d.grants.find((g) => !g.revokedAt && new Date(g.expiresAt) > new Date() && g.platformUserId === actor.userId);

  return (
    <>
      <PageHeader
        title={c.name}
        subtitle={<>
          <code className="tag-code">{c.code}</code> <Badge value={c.status} />
          {c.statusReason ? <> &middot; {c.statusReason}</> : null}
        </>}
        actions={<Link className="btn-secondary" href="/platform/companies">&larr; All companies</Link>}
      />

      <div className="cards">
        <Stat label="Active users" value={u ? n(u.users_active) : "—"} />
        <Stat label="Invited" value={u ? n(u.users_invited) : "—"} />
        <Stat label="Pitches" value={u ? n(u.pitches) : "—"} />
        <Stat label="Creators" value={u ? n(u.creators) : "—"} />
        <Stat label="Files" value={u ? n(u.documents) + n(u.images) : "—"} />
        <Stat label="Storage" value={u ? `${(n(u.storage_bytes) / 1024 ** 2).toFixed(1)} MB` : "—"} />
      </div>

      <div className="grid-2">
        <section className="section">
          <h2>Company admins</h2>
          {d.admins.length === 0 ? <p className="muted">No Company Admin on this workspace yet.</p> : (
            <table className="data">
              <thead><tr><th>Name</th><th>Email</th><th>Status</th></tr></thead>
              <tbody>{d.admins.map((a) => (
                <tr key={a.id}><td>{a.fullName}</td><td>{a.email}</td><td><Badge value={a.status} /></td></tr>
              ))}</tbody>
            </table>
          )}
        </section>

        <section className="section">
          <h2>Account</h2>
          <dl className="kv">
            <dt>Plan</dt><dd>{d.subscription?.planKey ? <code className="tag-code">{d.subscription.planKey}</code> : <span className="muted">&mdash;</span>}</dd>
            <dt>Subscription</dt><dd><Badge value={d.subscription?.status} /></dd>
            <dt>Ends on</dt><dd>{d.subscription?.endsOn ? fmtDate(d.subscription.endsOn) : <span className="muted">No end date</span>}</dd>
            <dt>Email domains</dt><dd>{d.domains.length ? <span className="chips">{d.domains.map((x) => <span key={x} className="chip">{x}</span>)}</span> : <span className="muted">None set</span>}</dd>
            <dt>Contact</dt><dd>{c.primaryEmail ?? <span className="muted">&mdash;</span>}</dd>
            <dt>Location</dt><dd>{[c.city, c.country].filter(Boolean).join(", ") || <span className="muted">&mdash;</span>}</dd>
            <dt>Data retention</dt><dd>{c.retentionDays} days</dd>
            <dt>Last activity</dt><dd>{u?.last_activity_at ? fmtDateTime(u.last_activity_at as string) : <span className="muted">&mdash;</span>}</dd>
          </dl>
        </section>
      </div>

      <section className="section">
        <h2>Manage</h2>
        <p className="subtle">Each action opens in place. Everything here is written to the platform audit trail.</p>
        <div className="action-stack">
          <ActionForm endpoint={`/api/v1/platform/companies/${c.id}/admins`} title="Add Company Admin" submitLabel="Create Company Admin" collapsed
            description="Creates the account as active right away with the password you set here — no invitation link or email needed. They must change it the moment they sign in, before they can do anything else, including inviting the rest of their team the normal way."
            fields={[
              { name: "fullName", label: "Full name", type: "text", required: true },
              { name: "email", label: "Email", type: "email", required: true },
              { name: "tempPassword", label: "Temporary password", type: "password", required: true, hint: "Tell them this password privately — it is not shown again." },
            ]} />

          <ActionForm endpoint={`/api/v1/platform/companies/${c.id}/subscription`} method="PATCH" title="Subscription & limits" submitLabel="Save subscription" collapsed
            description={`Current: ${d.subscription?.planKey ?? "—"} · ${d.subscription?.status ?? "—"}${d.subscription?.endsOn ? ` · ends ${fmtDate(d.subscription.endsOn)}` : ""}. Leave a limit empty to use the plan's value.`}
            fields={[
              { name: "planKey", label: "Plan", type: "select", options: plans.map((p) => ({ value: p.key, label: p.name })), defaultValue: d.subscription?.planKey },
              { name: "status", label: "Subscription status", type: "select", options: SUB, defaultValue: d.subscription?.status },
              { name: "endsOn", label: "Ends on", type: "date", defaultValue: d.subscription?.endsOn ?? undefined },
              { name: "limitOverrides.max_users", label: "Override: max users", type: "number", min: 1, defaultValue: overrides.max_users ?? undefined },
              { name: "limitOverrides.max_pitches", label: "Override: max active pitches", type: "number", min: 1, defaultValue: overrides.max_pitches ?? undefined },
            ]} />

          <ActionForm endpoint={`/api/v1/platform/companies/${c.id}/email-domains`} title="Allowed email domains" submitLabel="Save domains" collapsed
            description={`Employees must use one of these domains (or an exception approved by the Company Admin). Current: ${d.domains.join(", ") || "none"}`}
            fields={[{ name: "domains", label: "Domains (space or comma separated)", type: "textarea", defaultValue: d.domains.join(" ") }]} />

          <ActionForm endpoint={`/api/v1/platform/companies/${c.id}`} method="PATCH" title="Company profile" submitLabel="Save profile" collapsed
            fields={[
              { name: "name", label: "Name", type: "text", defaultValue: c.name }, { name: "legalName", label: "Legal name", type: "text", defaultValue: c.legalName ?? undefined },
              { name: "primaryEmail", label: "Contact email", type: "email", defaultValue: c.primaryEmail ?? undefined },
              { name: "contactPerson", label: "Contact person", type: "text", defaultValue: c.contactPerson ?? undefined },
              { name: "city", label: "City", type: "text", defaultValue: c.city ?? undefined }, { name: "country", label: "Country", type: "text", defaultValue: c.country ?? undefined },
              { name: "retentionDays", label: "Data retention (days)", type: "number", min: 30, max: 3650, defaultValue: c.retentionDays },
            ]} />

          <ActionForm endpoint={`/api/v1/platform/companies/${c.id}/status`} title="Change status" submitLabel="Apply status" collapsed danger
            description="Suspended, expired and archived companies are signed out immediately and cannot sign in."
            fields={[{ name: "status", label: "Status", type: "select", required: true, options: STATUS, defaultValue: c.status }, { name: "reason", label: "Reason (audited)", type: "text", required: true }]} />
        </div>
      </section>

      <section className="section">
        <h2>Support access</h2>
        <p className="subtle">Time-limited (max 4 hours), requires a reason, shows configuration and users only — never scripts, pitches or creators. Recorded in the company&rsquo;s own audit trail.</p>
        <SupportPanel companyId={c.id} activeGrantId={activeGrant?.id ?? null} activeUntil={activeGrant ? new Date(activeGrant.expiresAt).toISOString() : null} />
        {d.grants.length === 0 ? <p className="muted">No support access has ever been granted.</p> : (
          <table className="data">
            <thead><tr><th>Granted</th><th>Expires</th><th>State</th><th>Reason</th></tr></thead>
            <tbody>{d.grants.map((g) => {
              const live = !g.revokedAt && new Date(g.expiresAt) > new Date();
              return (
                <tr key={g.id}>
                  <td>{fmtDateTime(g.createdAt)}</td>
                  <td>{fmtDateTime(g.expiresAt)}</td>
                  <td><span className={"badge " + (g.revokedAt ? "b-hold" : live ? "b-approved" : "b-prod")}>{g.revokedAt ? "Revoked" : live ? "Active" : "Ended"}</span></td>
                  <td>{g.reason}</td>
                </tr>
              );
            })}</tbody>
          </table>
        )}
      </section>

      <section className="section">
        <h2>Subscription history</h2>
        {d.events.length === 0 ? <Empty>Nothing has changed on this subscription yet.</Empty> : (
          <table className="data">
            <thead><tr><th>When</th><th>Event</th><th>Details</th></tr></thead>
            <tbody>{d.events.map((e) => (
              <tr key={e.id}>
                <td>{fmtDateTime(e.createdAt)}</td>
                <td>{e.event.replaceAll("_", " ")}</td>
                <td>{e.after ? <code>{JSON.stringify(e.after).slice(0, 160)}</code> : <span className="muted">&mdash;</span>}</td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </section>
    </>
  );
}
