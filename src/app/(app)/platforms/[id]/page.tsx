import Link from "next/link";
import { getDb } from "@/server/db/client";
import { pageData, requirePageSession } from "@/server/lib/page-session";
import { can } from "@/server/modules/authz/policy";
import { getLookups, labelOf } from "@/server/modules/lookups/service";
import { getPlatform } from "@/server/modules/platforms/service";
import { ActionForm } from "@/components/action-form";
import { PLATFORM_STATUS_LABEL } from "@/components/labels";
import { Empty, fmtDate, PageHeader } from "@/components/ui";

export default async function PlatformPage({ params }: { params: Promise<{ id: string }> }) {
  const { actor } = await requirePageSession();
  const { id } = await params;
  const db = getDb();
  const data = await pageData(() => getPlatform(db, actor, id));
  if (!data) return <p className="notice">You do not have access to platforms.</p>;
  const { platform: p, contacts, pitches } = data;
  const lookups = await getLookups(db);
  const manage = can(actor, "platform.manage");
  const opts = (t: string) => (lookups[t] ?? []).map((l) => ({ value: l.key, label: l.label }));
  return (
    <>
      <PageHeader title={p.name} subtitle={`${p.kind} · ${p.active ? "Active" : "Disabled"}`} />
      <dl className="kv section">
        <dt>Languages</dt><dd>{p.languageKeys.map((k) => labelOf(lookups, "LANGUAGE", k)).join(", ") || "—"}</dd>
        <dt>Genres</dt><dd>{p.genreKeys.map((k) => labelOf(lookups, "GENRE", k)).join(", ") || "—"}</dd>
        <dt>Preferences</dt><dd>{p.preferences ?? "—"}</dd><dt>Notes</dt><dd>{p.notes ?? "—"}</dd>
      </dl>
      {manage && (
        <ActionForm endpoint={`/api/v1/platforms/${id}`} method="PATCH" title="Edit platform" submitLabel="Save" collapsed
          fields={[{ name: "name", label: "Name", type: "text", defaultValue: p.name }, { name: "languageKeys", label: "Languages", type: "checkboxes", options: opts("LANGUAGE"), defaultValue: p.languageKeys },
            { name: "genreKeys", label: "Genres", type: "checkboxes", options: opts("GENRE"), defaultValue: p.genreKeys }, { name: "preferences", label: "Preferences", type: "textarea", defaultValue: p.preferences ?? "" },
            { name: "notes", label: "Notes", type: "textarea", defaultValue: p.notes ?? "" }, { name: "active", label: "Active", type: "checkbox", defaultValue: p.active }]} />
      )}
      <section className="section">
        <h2>Contacts</h2>
        {manage && <ActionForm endpoint={`/api/v1/platforms/${id}/contacts`} title="+ Add contact" submitLabel="Add contact" collapsed
          fields={[{ name: "fullName", label: "Contact person", type: "text", required: true }, { name: "designation", label: "Designation", type: "text" }, { name: "department", label: "Department", type: "text" },
            { name: "email", label: "Email", type: "email" }, { name: "mobile", label: "Mobile", type: "text" }, { name: "notes", label: "Notes", type: "textarea" }]} />}
        {contacts.length === 0 ? <Empty>No contacts.</Empty> : (
          <table className="data"><thead><tr><th>Name</th><th>Designation</th><th>Department</th><th>Email</th><th>Mobile</th><th>Status</th>{manage && <th></th>}</tr></thead>
            <tbody>{contacts.map((c) => <tr key={c.id}><td>{c.fullName}</td><td>{c.designation ?? "—"}</td><td>{c.department ?? "—"}</td><td>{c.email ?? "—"}</td><td>{c.mobileE164 ?? "—"}</td><td>{c.active ? "Active" : "Inactive"}</td>
              {manage && <td><ActionForm endpoint={`/api/v1/platform-contacts/${c.id}`} method="PATCH" title={c.active ? "Deactivate" : "Activate"} submitLabel="Confirm" collapsed fields={[]} extra={{ active: !c.active }} /></td>}</tr>)}</tbody></table>
        )}
      </section>
      <section className="section">
        <h2>Pitches with {p.name}</h2>
        {pitches.length === 0 ? <Empty>None you can see.</Empty> : (
          <table className="data"><thead><tr><th>Date</th><th>Pitch</th><th>Round</th><th>Pitched by</th><th>Status</th><th>Follow-up</th></tr></thead>
            <tbody>{pitches.map((x) => <tr key={x.platformPitchId}><td>{fmtDate(x.pitchDate)}</td><td><Link href={`/pitches/${x.pitchId}?tab=platforms`}>{x.title}</Link></td><td>{x.roundNo}</td><td>{x.pitchedBy}</td><td>{PLATFORM_STATUS_LABEL[x.status]}</td><td>{fmtDate(x.nextFollowUpOn)}</td></tr>)}</tbody></table>
        )}
      </section>
    </>
  );
}
