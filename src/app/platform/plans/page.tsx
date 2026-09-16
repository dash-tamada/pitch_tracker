import { getPlatformDb } from "@/server/db/client";
import { requirePlatformPageSession } from "@/server/lib/page-session";
import { listPlans } from "@/server/modules/platform/service";
import { ActionForm } from "@/components/action-form";
import { PageHeader } from "@/components/ui";

const gb = (b: number | null | undefined) => (b == null ? "Unlimited" : `${(b / 1024 ** 3).toFixed(0)} GB`);
const mb = (b: number | null | undefined) => (b == null ? "Unlimited" : `${(b / 1024 ** 2).toFixed(0)} MB`);

export default async function PlansPage() {
  const { actor } = await requirePlatformPageSession();
  const plans = await listPlans(getPlatformDb(), actor);
  return (
    <>
      <PageHeader title="Plans & limits" subtitle="Limits are enforced on the server for every company on the plan. Per-company overrides are set on the company page." />
      <div className="table-wrap"><table className="data">
        <thead><tr><th>Plan</th><th>Key</th><th>Max users</th><th>Max active pitches</th><th>Storage</th><th>Max file</th><th>Active</th><th>Edit</th></tr></thead>
        <tbody>{plans.map((p) => {
          const l = p.limits as Record<string, number | null>;
          return (
            <tr key={p.key}><td>{p.name}</td><td>{p.key}</td><td>{l.max_users ?? "Unlimited"}</td><td>{l.max_pitches ?? "Unlimited"}</td><td>{gb(l.storage_bytes)}</td><td>{mb(l.max_file_bytes)}</td><td>{p.active ? "Yes" : "No"}</td>
              <td><ActionForm endpoint="/api/v1/platform/plans" title="Edit" submitLabel="Save plan" collapsed extra={{ key: p.key, sortOrder: p.sortOrder }}
                fields={[{ name: "name", label: "Name", type: "text", required: true, defaultValue: p.name },
                  { name: "limits.max_users", label: "Max users (empty = unlimited)", type: "number", min: 1, defaultValue: l.max_users ?? undefined },
                  { name: "limits.max_pitches", label: "Max active pitches", type: "number", min: 1, defaultValue: l.max_pitches ?? undefined },
                  { name: "limits.storage_bytes", label: "Storage (bytes)", type: "number", min: 0, defaultValue: l.storage_bytes ?? undefined },
                  { name: "limits.max_file_bytes", label: "Max file size (bytes)", type: "number", min: 1024, defaultValue: l.max_file_bytes ?? undefined },
                  { name: "active", label: "Available for new companies", type: "checkbox", defaultValue: p.active }]} /></td></tr>
          );
        })}</tbody>
      </table></div>
    </>
  );
}
