import { getDb } from "@/server/db/client";
import { requirePageSession } from "@/server/lib/page-session";
import { can } from "@/server/modules/authz/policy";
import { listRolesWithPermissions, listUsers } from "@/server/modules/users/admin";
import { ActionForm } from "@/components/action-form";
import { RoleEditor } from "@/components/role-editor";
import { fmtDateTime, PageHeader } from "@/components/ui";

const ROLE_OPTS = ["COMPANY_ADMIN", "ADMIN", "SENIOR_EMPLOYEE", "EMPLOYEE", "CEO", "COO", "VIEWER"].map((r) => ({ value: r, label: r.replaceAll("_", " ") }));
const CLEARANCE = ["STANDARD", "CONFIDENTIAL", "RESTRICTED"].map((c) => ({ value: c, label: c }));

export default async function UsersPage() {
  const { actor } = await requirePageSession();
  const db = getDb(actor);
  const users = can(actor, "user.manage") ? await listUsers(db, actor) : null;
  const roles = can(actor, "role.manage") ? await listRolesWithPermissions(db, actor) : null;
  if (!users && !roles) return <p className="notice">Administrators only.</p>;
  return (
    <>
      <PageHeader title="Users & roles" subtitle="People are invited with a one-time link and choose their own password — admins never see passwords. Access changes sign the user out everywhere." />
      {users && (
        <>
          <ActionForm endpoint="/api/v1/admin/users" title="+ Invite employee" submitLabel="Send invitation" collapsed after="result"
            description="The address must use your company email domain (or an exception on the Company page). If email is not configured, copy the invitation link shown and send it privately. It works once and expires in 72 hours."
            fields={[{ name: "fullName", label: "Full name", type: "text", required: true }, { name: "email", label: "Work email", type: "email", required: true },
              { name: "department", label: "Department", type: "text" }, { name: "designation", label: "Designation", type: "text" },
              { name: "employeeCode", label: "Employee code", type: "text" }, { name: "mobileE164", label: "Mobile (+91…)", type: "text" },
              { name: "joiningDate", label: "Joining date", type: "date" },
              { name: "roleKeys", label: "Roles", type: "checkboxes", required: true, options: ROLE_OPTS }, { name: "clearance", label: "Clearance", type: "select", options: CLEARANCE, defaultValue: "CONFIDENTIAL" }]} />
          <div className="table-wrap"><table className="data">
            <thead><tr><th>Name</th><th>Email</th><th>Department</th><th>Roles</th><th>Clearance</th><th>Status</th><th>MFA</th><th>Last sign-in</th><th>Manage</th></tr></thead>
            <tbody>{users.map((u) => (
              <tr key={u.id}>
                <td>{u.fullName}{u.designation ? <><br /><span className="subtle">{u.designation}</span></> : null}</td><td>{u.email}</td><td>{u.department ?? "—"}</td><td>{u.roles.join(", ")}</td><td>{u.clearance}</td>
                <td>{u.status}{u.lockedUntil && u.lockedUntil > new Date() ? " · locked" : ""}</td><td>{u.mfaEnabled ? "On" : "Off"}</td><td>{fmtDateTime(u.lastLoginAt)}</td>
                <td>{u.id !== actor.userId && (
                  <>
                    <ActionForm endpoint={`/api/v1/admin/users/${u.id}`} method="PATCH" title="Change access" submitLabel="Save" collapsed
                      fields={[{ name: "roleKeys", label: "Roles", type: "checkboxes", options: ROLE_OPTS, defaultValue: u.roles },
                        { name: "clearance", label: "Clearance", type: "select", options: CLEARANCE, defaultValue: u.clearance },
                        { name: "status", label: "Status", type: "select", options: [{ value: "ACTIVE", label: "Active" }, { value: "DISABLED", label: "Disabled" }], defaultValue: u.status === "INVITED" ? undefined : u.status },
                        { name: "reassignToUserId", label: "When disabling: move their open pitches to", type: "user", hint: "Required if they own open pitches." },
                        { name: "unlock", label: "Unlock account", type: "checkbox" }]} />
                    {u.status === "INVITED" && <ActionForm endpoint={`/api/v1/admin/users/${u.id}/invitation`} title="Resend invite" submitLabel="Issue new invitation" collapsed after="result" fields={[]}
                      description="The previous invitation link stops working." />}
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
          <p className="subtle">Company Admin always has every company permission. You cannot edit a role you hold, and only a Company Admin can grant administration permissions.</p>
          {roles.roles.map((r) => <RoleEditor key={r.key} roleKey={r.key} all={roles.permissions} granted={r.permissions} locked={r.key === "COMPANY_ADMIN" || actor.roles.has(r.key)} />)}
        </section>
      )}
    </>
  );
}
