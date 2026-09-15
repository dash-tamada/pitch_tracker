import { getDb } from "@/server/db/client";
import { requirePageSession } from "@/server/lib/page-session";
import { can } from "@/server/modules/authz/policy";
import { getActiveWorkflow, getAllSettings, listLookups, queryAudit } from "@/server/modules/admin/config";
import { getRatingCategories } from "@/server/modules/lookups/service";
import { ActionForm } from "@/components/action-form";
import { WorkflowJsonEditor } from "@/components/json-publish";
import { fmtDateTime, PageHeader, Tabs } from "@/components/ui";

const TABS = [{ key: "general", label: "General" }, { key: "lists", label: "Lists" }, { key: "workflow", label: "Workflow" }, { key: "audit", label: "Audit log" }];
const TYPES = ["GENRE", "SUB_GENRE", "LANGUAGE", "FORMAT", "REJECTION_CATEGORY", "CHANGE_REQUEST_TYPE", "DOCUMENT_CATEGORY", "IMAGE_CATEGORY", "BUDGET_RANGE", "TARGET_AUDIENCE", "PITCH_METHOD"];

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ tab?: string; action?: string; cursor?: string }> }) {
  const { actor } = await requirePageSession();
  const sp = await searchParams;
  const tab = TABS.some((t) => t.key === sp.tab) ? sp.tab! : "general";
  const db = getDb();
  if (!can(actor, "config.manage") && !can(actor, "workflow.manage") && !can(actor, "audit.view")) return <p className="notice">Administrators only.</p>;
  return (
    <>
      <PageHeader title="Settings" subtitle="Configure the system without code changes. Every change is audited." />
      <Tabs base="/settings" current={tab} tabs={TABS} />
      {tab === "general" && can(actor, "config.manage") && <General />}
      {tab === "lists" && can(actor, "config.manage") && <Lists />}
      {tab === "workflow" && can(actor, "workflow.manage") && <Workflow />}
      {tab === "audit" && can(actor, "audit.view") && <Audit action={sp.action} cursor={sp.cursor} />}
    </>
  );

  async function General() {
    const s = await getAllSettings(db, actor);
    return (
      <ActionForm endpoint="/api/v1/admin/settings" method="PATCH" title="Policies" submitLabel="Save settings"
        description="Relaxing approval rules requires a Super Admin."
        fields={[
          { name: "executive_approval_mode", label: "CEO / COO approval", type: "select", defaultValue: s.executive_approval_mode, options: [{ value: "ANY", label: "Either CEO or COO" }, { value: "ALL", label: "Both CEO and COO" }] },
          { name: "allow_self_approval", label: "Allow people to approve pitches they submitted", type: "checkbox", defaultValue: s.allow_self_approval },
          { name: "ratings_visibility", label: "Who can see rating history", type: "select", defaultValue: s.ratings_visibility, options: [{ value: "MANAGEMENT", label: "Management only" }, { value: "ALL_EMPLOYEES", label: "All reviewers" }] },
          { name: "aging_thresholds_days.attention", label: "Aging: attention after (days)", type: "number", min: 1, defaultValue: s.aging_thresholds_days.attention },
          { name: "aging_thresholds_days.overdue", label: "Aging: overdue after (days)", type: "number", min: 1, defaultValue: s.aging_thresholds_days.overdue },
          { name: "aging_thresholds_days.critical", label: "Aging: critical after (days)", type: "number", min: 1, defaultValue: s.aging_thresholds_days.critical },
        ]} />
    );
  }

  async function Lists() {
    const [lookups, cats] = await Promise.all([listLookups(db, actor), getRatingCategories(db)]);
    return (
      <>
        <ActionForm endpoint="/api/v1/admin/lookups" title="+ Add or rename a list value" submitLabel="Save" collapsed
          description="Keys are permanent identifiers (e.g. MARATHI). Existing keys are relabelled or deactivated, never deleted, so history stays readable."
          fields={[{ name: "type", label: "List", type: "select", required: true, options: TYPES.map((t) => ({ value: t, label: t.replaceAll("_", " ").toLowerCase() })) },
            { name: "key", label: "Key", type: "text", required: true, placeholder: "UPPER_CASE" }, { name: "label", label: "Label", type: "text", required: true },
            { name: "active", label: "Active", type: "checkbox", defaultValue: true }]} />
        <ActionForm endpoint="/api/v1/admin/rating-categories" title="+ Rating category" submitLabel="Save" collapsed
          fields={[{ name: "key", label: "Key", type: "text", required: true }, { name: "label", label: "Label", type: "text", required: true }, { name: "active", label: "Active", type: "checkbox", defaultValue: true }]} />
        <section className="section"><h2>Rating categories</h2><p>{cats.map((c) => c.label).join(" · ")}</p></section>
        {TYPES.map((t) => (
          <section key={t} className="section"><h2>{t.replaceAll("_", " ").toLowerCase()}</h2>
            <div className="chips">{lookups.filter((l) => l.type === t).map((l) => <span key={l.id} className="chip">{l.label} <span className="muted">({l.key}{l.active ? "" : ", inactive"})</span></span>)}</div>
          </section>
        ))}
      </>
    );
  }

  async function Workflow() {
    const wf = await getActiveWorkflow(db, actor);
    const payload = { name: wf.definition.name, initialStageKey: wf.definition.initialStageKey,
      stages: wf.stages.map((s) => ({ key: s.key, name: s.name, category: s.category, badge: s.badge, isTerminal: s.isTerminal, requiresOwner: s.requiresOwner })),
      transitions: wf.transitions.map(({ id: _i, definitionId: _d, ...t }) => t) };
    return (
      <>
        <section className="section"><h2>Active: {wf.definition.name} v{wf.definition.version}</h2>
          <table className="data"><thead><tr><th>From</th><th>Action</th><th>To</th><th>Permission</th><th>Roles</th><th>Owner only</th><th>Requires</th></tr></thead>
            <tbody>{wf.transitions.map((t) => <tr key={t.id}><td>{t.fromStageKey}</td><td>{t.action}</td><td>{t.toStageKey ?? "(previous)"}</td><td>{t.requiredPermission}</td>
              <td>{t.allowedRoleKeys?.join(", ") ?? "any"}</td><td>{t.requiresCurrentOwner ? "Yes" : "No"}</td>
              <td>{[t.requiresRemarks && "remarks", t.requiresRejectionReason && "reason", t.requiresRecipient && "recipient", t.requiresChangeTypes && "change types", t.requiresPlatform && "platform", t.isApproval && "approval"].filter(Boolean).join(", ")}</td></tr>)}</tbody></table>
          <p className="subtle">Versions: {wf.versions.map((v) => `v${v.version}${v.isActive ? " (active)" : ""}`).join(", ")}</p>
        </section>
        <WorkflowJsonEditor initial={JSON.stringify(payload, null, 2)} />
      </>
    );
  }

  async function Audit({ action, cursor }: { action?: string; cursor?: string }) {
    const page = await queryAudit(db, actor, { ...(action ? { action } : {}), ...(cursor ? { cursor } : {}), limit: 100 });
    return (
      <>
        <form className="filters" method="get"><input type="hidden" name="tab" value="audit" />
          <label className="field">Action starts with<input name="action" defaultValue={action ?? ""} placeholder="e.g. document.downloaded" /></label><button className="btn-secondary">Filter</button></form>
        <div className="table-wrap"><table className="data">
          <thead><tr><th>When</th><th>Who</th><th>Action</th><th>Resource</th><th>Details</th><th>IP</th></tr></thead>
          <tbody>{page.items.map((a) => <tr key={a.id}><td>{fmtDateTime(a.createdAt)}</td><td>{a.actorName ?? "System / anonymous"}</td><td>{a.action}</td>
            <td>{a.resourceType}{a.resourceId ? ` ${a.resourceId.slice(0, 8)}` : ""}</td><td><code>{JSON.stringify(a.after ?? {}).slice(0, 160)}</code></td><td>{a.ip ?? ""}</td></tr>)}</tbody>
        </table></div>
        {page.nextCursor && <div className="pager"><a className="btn-secondary" href={`/settings?tab=audit&cursor=${page.nextCursor}${action ? `&action=${encodeURIComponent(action)}` : ""}`}>Older →</a></div>}
      </>
    );
  }
}
