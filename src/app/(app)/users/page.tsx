import { getDb } from "@/server/db/client";
import { requirePageSession } from "@/server/lib/page-session";
import { can } from "@/server/modules/authz/policy";
import { listRolesWithPermissions, listUsers } from "@/server/modules/users/admin";
import { ActionForm } from "@/components/action-form";
import { RoleEditor } from "@/components/role-editor";
import { fmtDateTime, PageHeader } from "@/components/ui";

const ROLE_OPTS = ["SUPER_ADMIN", "ADMIN", "SENIOR_EMPLOYEE", "EMPLOYEE", "CEO", "COO", "VIEWER"].map((r) => ({ value: r, label: r.replaceAll("_", " ") }));
const CLEARANCE = ["STANDARD", "CONFIDENTIAL", "RESTRICTED"].map((c) => ({ value: c, label: c }));

export default async function UsersPage() {
  const { actor } = await requirePageSession();
  const db = getDb();
  const users = can(actor, "user.manage") ? await listUsers(db, actor) : null;
  const roles = can(actor, "role.manage") ? await listRolesWithPermissions(db, actor) : null;
  if (!users && !roles) return <p className="notice">Administrators only.</p>;
  return (
    <>
      <PageHeader title="Users & roles" subtitle="New users get a one-time link to set their own password. Access changes sign the user out everywhere." />
      {users && (
        <>
          <ActionForm endpoint="/api/v1/admin/users" title="+ Add user" submitLabel="Create user" collapsed after="result"
            description="Copy the set-password link shown after creating and send it to the person privately. It works once and expires in 72 hours."
            fields={[{ name: "fullName", label: "Full name", type: "text", required: true }, { name: "email", label: "Work email", type: "email", required: true },
              { name: "roleKeys", label: "Roles", type: "checkboxes", required: true, options: ROLE_OPTS }, { name: "clearance", label: "Clearance", type: "select", options: CLEARANCE, defaultValue: "CONFIDENTIAL" }]} />
          <div className="table-wrap"><table className="data">
            <thead><tr><th>Name</th><th>Email</th><th>Roles</th><th>Clearance</th><th>Status</th><th>MFA</th><th>Last sign-in</th><th>Manage</th></tr></thead>
            <tbody>{users.map((u) => (
              <tr key={u.id}>
                <td>{u.fullName}</td><td>{u.email}</td><td>{u.roles.join(", ")}</td><td>{u.clearance}</td>
                <td>{u.status}{u.lockedUntil && u.lockedUntil > new Date() ? " · locked" : ""}</td><td>{u.mfaEnabled ? "On" : "Off"}</td><td>{fmtDateTime(u.lastLoginAt)}</td>
                <td>{u.id !== actor.userId && (
                  <>
                    <ActionForm endpoint={`/api/v1/admin/users/${u.id}`} method="PATCH" title="Change access" submitLabel="Save" collapsed
                      fields={[{ name: "roleKeys", label: "Roles", type: "checkboxes", options: ROLE_OPTS, defaultValue: u.roles },
                        { name: "clearance", label: "Clearance", type: "select", options: CLEARANCE, defaultValue: u.clearance },
                        { name: "status", label: "Status", type: "select", options: [{ value: "ACTIVE", label: "Active" }, { value: "DISABLED", label: "Disabled" }], defaultValue: u.status },
                        { name: "unlock", label: "Unlock account", type: "checkbox" }]} />
                    <ActionForm endpoint={`/api/v1/admin/users/${u.id}/reset-link`} title="Reset link" submitLabel="Issue reset link" collapsed after="result" fields={[]}
                      description="Signs the user out and gives you a one-time link to send them." />
                  </>
                )}</td>
              </tr>
            ))}</tbody>
          </table></div>
        </>
      )}
      {roles && (
        <section className="section">
          <h2>Roles & permissions</h2>
          <p className="subtle">Super Admin always has everything. You cannot edit a role you hold, and only a Super Admin can grant administration permissions.</p>
          {roles.roles.map((r) => <RoleEditor key={r.key} roleKey={r.key} all={roles.permissions} granted={r.permissions} locked={r.key === "SUPER_ADMIN" || actor.roles.has(r.key)} />)}
        </section>
      )}
    </>
  );
}
