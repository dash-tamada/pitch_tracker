/**
 * Permission catalogue and DEFAULT role matrix. These are seed values only:
 * at runtime the database (roles, role_permissions, user_roles) is authoritative
 * and Admins edit it without code changes.
 */

export const PERMISSIONS = {
  "pitch.create": "Create pitches",
  "pitch.view": "View pitches the user is involved in",
  "pitch.view_all": "View all pitches up to the user's clearance",
  "pitch.edit": "Edit pitch information",
  "pitch.forward": "Assign or forward pitches",
  "pitch.accept": "Accept / recommend pitches",
  "pitch.reject": "Reject pitches",
  "pitch.request_changes": "Request changes",
  "pitch.hold": "Put pitches on hold and resume",
  "pitch.approve_executive": "CEO/COO approval, send back, greenlight",
  "pitch.send_to_platform": "Approve a pitch for platform pitching",
  "pitch.reopen": "Reopen rejected pitches",
  "pitch.archive": "Archive pitches",
  "pitch.restore": "Restore archived pitches",
  "document.upload": "Upload documents, scripts and images",
  "document.download": "Download confidential documents",
  "document.view_meta": "See document lists and version history",
  "creator.view": "View creator profiles",
  "creator.view_pii": "See creators' full mobile and email",
  "creator.create": "Create creators",
  "creator.edit": "Edit creators",
  "creator.archive": "Archive creators",
  "rating.view": "View ratings",
  "rating.add": "Add ratings",
  "platform.view": "View platforms",
  "platform.manage": "Add, edit and disable platforms and contacts",
  "platform.pitch": "Record a pitch to a platform",
  "platform.record_response": "Record platform responses",
  "development.manage": "Manage development tracker",
  "production.manage": "Manage production tracker",
  "analytics.view": "View dashboards and analytics",
  "report.view": "View management reports",
  "data.export": "Export data",
  "user.manage": "Manage users",
  "role.manage": "Manage roles and permissions",
  "workflow.manage": "Configure workflow",
  "config.manage": "Manage lookups and settings",
  "audit.view": "View audit logs",
} as const;

export type Permission = keyof typeof PERMISSIONS;
export const ALL_PERMISSIONS = Object.keys(PERMISSIONS) as Permission[];

export const ROLE_KEYS = ["SUPER_ADMIN", "ADMIN", "SENIOR_EMPLOYEE", "EMPLOYEE", "CEO", "COO", "VIEWER"] as const;
export type RoleKey = (typeof ROLE_KEYS)[number];

const REVIEW: Permission[] = [
  "pitch.create", "pitch.view", "pitch.edit", "pitch.forward", "pitch.accept", "pitch.reject",
  "pitch.request_changes", "pitch.hold", "document.upload", "document.download", "document.view_meta",
  "creator.view", "creator.create", "rating.add", "platform.view", "platform.pitch", "platform.record_response",
];

const SENIOR_EXTRA: Permission[] = [
  "pitch.view_all", "pitch.reopen", "creator.view_pii", "creator.edit", "rating.view",
  "development.manage", "production.manage", "analytics.view", "report.view",
];

const EXECUTIVE_EXTRA: Permission[] = [
  "pitch.approve_executive", "pitch.send_to_platform", "pitch.archive", "pitch.restore", "data.export",
];

export const DEFAULT_ROLE_MATRIX: Record<RoleKey, { name: string; permissions: Permission[] }> = {
  SUPER_ADMIN: { name: "Super Admin", permissions: [...ALL_PERMISSIONS] },
  // Separation of duties: Admin runs the system but cannot read scripts or decide on pitches.
  ADMIN: {
    name: "Admin",
    permissions: [
      "creator.view", "creator.view_pii", "creator.create", "creator.edit", "creator.archive",
      "platform.view", "platform.manage", "analytics.view", "report.view",
      "user.manage", "role.manage", "workflow.manage", "config.manage", "audit.view",
    ],
  },
  SENIOR_EMPLOYEE: { name: "Senior Employee", permissions: [...REVIEW, ...SENIOR_EXTRA] },
  EMPLOYEE: { name: "Employee", permissions: [...REVIEW] },
  CEO: { name: "CEO", permissions: [...REVIEW, ...SENIOR_EXTRA, ...EXECUTIVE_EXTRA] },
  COO: { name: "COO", permissions: [...REVIEW, ...SENIOR_EXTRA, ...EXECUTIVE_EXTRA] },
  VIEWER: { name: "Viewer", permissions: ["pitch.view", "creator.view", "platform.view", "analytics.view", "report.view"] },
};

/** Roles that must use MFA before any protected action. */
export const MFA_REQUIRED_ROLES: ReadonlySet<RoleKey> = new Set(["SUPER_ADMIN", "ADMIN", "CEO", "COO"]);
