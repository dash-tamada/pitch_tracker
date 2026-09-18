import { getDb } from "@/server/db/client";
import { requirePageSession } from "@/server/lib/page-session";
import { can } from "@/server/modules/authz/policy";
import { getMyCompany } from "@/server/modules/tenancy/company";
import { ActionForm } from "@/components/action-form";
import { CreatorPortalLinkPanel } from "@/components/creator-portal-link-panel";
import { LogoUploadPanel } from "@/components/logo-upload-panel";
import { fmtDate, PageHeader, Stat } from "@/components/ui";

const lim = (v: number | null | undefined, unit = "") => (v == null ? "Unlimited" : `${v}${unit}`);

export default async function CompanyPage() {
  const { actor } = await requirePageSession();
  if (!can(actor, "company.manage")) return <p className="notice">Company Admins only.</p>;
  const d = await getMyCompany(getDb(actor), actor);
  const c = d.company;
  return (
    <>
      <PageHeader title="Company" subtitle={`${c.name} · ${c.code} · ${c.status.replaceAll("_", " ")}`} />
      {!c.setupCompletedAt && (
        <ActionForm endpoint="/api/v1/company" method="PATCH" title="Finish setting up your company" submitLabel="Save and finish setup" extra={{ completeSetup: true }}
          description="Step 1: confirm your company details. Step 2: invite your team from Users. Step 3: review Settings (lists, workflow, approval rules)."
          fields={[{ name: "name", label: "Company name", type: "text", defaultValue: c.name }, { name: "legalName", label: "Legal name", type: "text", defaultValue: c.legalName ?? undefined },
            { name: "city", label: "City", type: "text", defaultValue: c.city ?? undefined }, { name: "contactPerson", label: "Contact person", type: "text", defaultValue: c.contactPerson ?? undefined }]} />
      )}
      <div className="cards">
        <Stat label="Plan" value={d.subscription.planName ?? "—"} hint={d.subscription.status ?? undefined} />
        <Stat label="Users (active / invited)" value={`${d.usage.usersActive} / ${d.usage.usersInvited}`} hint={`Limit: ${lim(d.subscription.limits.max_users)}`} />
        <Stat label="Storage used" value={`${(d.usage.storageBytes / 1024 ** 2).toFixed(1)} MB`} hint={`Limit: ${d.subscription.limits.storage_bytes == null ? "Unlimited" : `${(d.subscription.limits.storage_bytes / 1024 ** 3).toFixed(0)} GB`}`} />
        <Stat label="Subscription ends" value={fmtDate(d.subscription.endsOn)} />
      </div>
      <LogoUploadPanel hasLogo={c.hasLogo} logoUrl={c.hasLogo ? "/api/v1/company/logo" : null} companyName={c.name} />
      <ActionForm endpoint="/api/v1/company" method="PATCH" title="Profile & branding" submitLabel="Save" collapsed
        fields={[
          { name: "name", label: "Company name", type: "text", defaultValue: c.name }, { name: "legalName", label: "Legal name", type: "text", defaultValue: c.legalName ?? undefined },
          { name: "brandPrimaryColor", label: "Brand colour (#RRGGBB)", type: "text", defaultValue: c.brandPrimaryColor ?? undefined, maxLength: 7 },
          { name: "pitchCodePrefix", label: "Pitch code prefix", type: "text", defaultValue: c.pitchCodePrefix ?? c.code, hint: "New pitches are numbered PREFIX-YEAR-000001." },
          { name: "website", label: "Website (https://)", type: "url", defaultValue: c.website ?? undefined },
          { name: "primaryEmail", label: "Contact email", type: "email", defaultValue: c.primaryEmail ?? undefined },
          { name: "contactPhone", label: "Contact phone (+91…)", type: "text", defaultValue: c.contactPhone ?? undefined },
          { name: "city", label: "City", type: "text", defaultValue: c.city ?? undefined }, { name: "state", label: "State", type: "text", defaultValue: c.state ?? undefined },
          { name: "address", label: "Address", type: "textarea", defaultValue: c.address ?? undefined },
        ]} />
      <section className="section">
        <h2>Who can be invited</h2>
        <p>Company email domains (set by the platform): <strong>{d.domains.join(", ") || "none"}</strong></p>
        <p className="subtle">Exceptions let one exact address join (for example a freelance consultant). Every exception is audited.</p>
        <ul>{d.exceptions.map((e) => <li key={e.email}>{e.email} — {e.reason}</li>)}</ul>
        <ActionForm endpoint="/api/v1/company/email-exceptions" title="+ Add exception" submitLabel="Allow this address" collapsed
          fields={[{ name: "email", label: "Email", type: "email", required: true }, { name: "reason", label: "Reason", type: "text", required: true }]} />
        <ActionForm endpoint="/api/v1/company/email-exceptions/remove" title="Remove exception" submitLabel="Remove" collapsed danger
          fields={[{ name: "email", label: "Email", type: "email", required: true }]} />
      </section>
      <CreatorPortalLinkPanel />
    </>
  );
}
