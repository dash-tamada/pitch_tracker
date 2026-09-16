import { getPlatformDb } from "@/server/db/client";
import { uuidParam } from "@/server/lib/http";
import { pageData, requirePlatformPageSession } from "@/server/lib/page-session";
import { getCompany, listPlans } from "@/server/modules/platform/service";
import { ActionForm } from "@/components/action-form";
import { SupportPanel } from "@/components/support-panel";
import { fmtDate, fmtDateTime, PageHeader } from "@/components/ui";

const STATUS = ["TRIAL", "ACTIVE", "SUSPENDED", "EXPIRED", "ARCHIVED"].map((s) => ({ value: s, label: s }));
const SUB = ["TRIAL", "ACTIVE", "PAST_DUE", "SUSPENDED", "EXPIRED", "CANCELLED"].map((s) => ({ value: s, label: s.replaceAll("_", " ") }));

export default async function CompanyDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { actor } = await requirePlatformPageSession();
  const { id } = await params;
  const db = getPlatformDb();
  const d = await pageData(() => getCompany(db, actor, uuidParam(id, "Company")));
  if (!d) return <p className="notice">Not available.</p>;
  const plans = await listPlans(db, actor);
  const c = d.company;
  const overrides = (d.subscription?.limitOverrides ?? {}) as Record<string, number | null>;
  const activeGrant = d.grants.find((g) => !g.revokedAt && new Date(g.expiresAt) > new Date() && g.platformUserId === actor.userId);
  return (
    <>
      <PageHeader title={c.name} subtitle={`${c.code} · ${c.status.replaceAll("_", " ")}${c.statusReason ? ` — ${c.statusReason}` : ""}`} />
      <section className="section"><h2>Usage</h2>
        <p>{d.usage ? `Users: ${d.usage.users_active} active, ${d.usage.users_invited} invited · Pitches: ${d.usage.pitches} · Creators: ${d.usage.creators} · Files: ${Number(d.usage.documents) + Number(d.usage.images)} · Storage: ${(Number(d.usage.storage_bytes) / 1024 ** 2).toFixed(1)} MB · Last activity: ${fmtDateTime(d.usage.last_activity_at as string | null)}` : "—"}</p>
        <p className="subtle">Company Admins: {d.admins.map((a) => `${a.fullName} <${a.email}> (${a.status})`).join(", ") || "none"}</p>
      </section>

      <ActionForm endpoint={`/api/v1/platform/companies/${c.id}/admins`} title="Add Company Admin (email + temp password)" submitLabel="Create Company Admin" collapsed
        description="Creates the account as active right away with the password you set here — no invitation link or email needed. They must change it the moment they sign in, before they can do anything else, including inviting the rest of their team the normal way."
        fields={[
          { name: "fullName", label: "Full name", type: "text", required: true },
          { name: "email", label: "Email", type: "email", required: true },
          { name: "tempPassword", label: "Temporary password", type: "password", required: true, hint: "At least 12 characters (or 16+ of any kind). Tell them this password privately — it is not shown again." },
        ]} />

      <ActionForm endpoint={`/api/v1/platform/companies/${c.id}/status`} title="Change status" submitLabel="Apply status" collapsed danger
        description="Suspended, expired and archived companies are signed out immediately and cannot sign in."
        fields={[{ name: "status", label: "Status", type: "select", required: true, options: STATUS, defaultValue: c.status }, { name: "reason", label: "Reason (audited)", type: "text", required: true }]} />

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

      <section className="section">
        <h2>Support access</h2>
        <p className="subtle">Time-limited (max 4 hours), requires a reason, shows configuration and users only — never scripts, pitches or creators. Recorded in the company's own audit trail.</p>
        <SupportPanel companyId={c.id} activeGrantId={activeGrant?.id ?? null} activeUntil={activeGrant ? new Date(activeGrant.expiresAt).toISOString() : null} />
        <ul>{d.grants.map((g) => <li key={g.id}>{fmtDateTime(g.createdAt)} → {fmtDateTime(g.expiresAt)}{g.revokedAt ? " (revoked)" : ""}: {g.reason}</li>)}</ul>
      </section>

      <section className="section"><h2>Subscription history</h2>
        <ul>{d.events.map((e) => <li key={e.id}>{fmtDateTime(e.createdAt)} · {e.event} · {JSON.stringify(e.after)}</li>)}</ul>
      </section>
    </>
  );
}
