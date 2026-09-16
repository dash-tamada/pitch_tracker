/**
 * Idempotent provisioning.
 *  - seedPlatform(platformDb): permission catalogue, default plans, the master OTT/platform list. No people, no content.
 *  - ensureCompanyDefaults(companyDb): one company's roles, lookups, rating categories, platforms, settings and workflow.
 *    Runs on the company-scoped connection, so every row it writes belongs to that company by construction.
 * Safe to re-run: never overwrites an admin's edits (except keeping COMPANY_ADMIN complete).
 */
import { and, eq, inArray } from "drizzle-orm";
import type { Db } from "@/server/db/client";
import {
  lookupValues, permissions, plans, platformCatalog, platforms, ratingCategories, rolePermissions, roles, systemSettings,
  workflowDefinitions, workflowStages, workflowTransitions,
} from "@/server/db/schema";
import { DEFAULT_ROLE_MATRIX, PERMISSIONS, PLATFORM_PERMISSIONS, ROLE_KEYS } from "@/server/modules/authz/permissions";
import { DEFAULT_SETTINGS, LOOKUPS, RATING_CATEGORIES, SEED_PLATFORMS } from "@/server/config/seed-config";
import { DEFAULT_STAGES, DEFAULT_TRANSITIONS, DEFAULT_WORKFLOW_NAME, INITIAL_STAGE } from "@/server/config/default-workflow";

const GiB = 1024 ** 3, MiB = 1024 ** 2;

/** Starting plans. Limits live in the database (plans.limits) and are edited by the Super Admin; null = unlimited. */
export const DEFAULT_PLANS = [
  { key: "STARTER", name: "Starter", sortOrder: 1, limits: { max_users: 10, max_pitches: 500, storage_bytes: 10 * GiB, max_file_bytes: 25 * MiB } },
  { key: "PROFESSIONAL", name: "Professional", sortOrder: 2, limits: { max_users: 50, max_pitches: 5000, storage_bytes: 100 * GiB, max_file_bytes: 50 * MiB } },
  { key: "ENTERPRISE", name: "Enterprise", sortOrder: 3, limits: { max_users: null, max_pitches: null, storage_bytes: 1024 * GiB, max_file_bytes: 100 * MiB } },
] as const;

export async function seedPlatform(db: Db): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.insert(permissions).values(Object.entries(PERMISSIONS).map(([key, description]) => ({ key, description, scope: "COMPANY" as const }))).onConflictDoNothing();
    await tx.insert(permissions).values(Object.entries(PLATFORM_PERMISSIONS).map(([key, description]) => ({ key, description, scope: "PLATFORM" as const }))).onConflictDoNothing();
    await tx.insert(plans).values(DEFAULT_PLANS.map((p) => ({ key: p.key, name: p.name, sortOrder: p.sortOrder, limits: p.limits }))).onConflictDoNothing();
    const have = new Set((await tx.select({ name: platformCatalog.name }).from(platformCatalog)).map((r) => r.name.toLowerCase()));
    const missing = SEED_PLATFORMS.filter((n) => !have.has(n.toLowerCase()));
    if (missing.length) await tx.insert(platformCatalog).values(missing.map((name) => ({ name, kind: name === "YouTube" ? "AVOD" : "OTT" })));
  });
}

/** Must be called with a company-scoped handle (getDb(actor) / tenantDb(companyId)). */
export async function ensureCompanyDefaults(db: Db): Promise<void> {
  await db.transaction(async (tx) => {
    const companyPermissionKeys = (await tx.select({ key: permissions.key }).from(permissions).where(eq(permissions.scope, "COMPANY"))).map((p) => p.key);
    if (companyPermissionKeys.length === 0) throw new Error("Permission catalogue is empty: run the platform seed first.");

    for (const key of ROLE_KEYS) {
      const def = DEFAULT_ROLE_MATRIX[key];
      await tx.insert(roles).values({ key, name: def.name, isSystem: true }).onConflictDoNothing();
      const [role] = await tx.select({ id: roles.id }).from(roles).where(eq(roles.key, key));
      const existing = await tx.select({ k: rolePermissions.permissionKey }).from(rolePermissions).where(eq(rolePermissions.roleId, role!.id));
      if (key === "COMPANY_ADMIN") {
        // The company's top role always holds every company permission (including ones added in later releases).
        const have = new Set(existing.map((e) => e.k));
        const add = companyPermissionKeys.filter((k) => !have.has(k));
        if (add.length) await tx.insert(rolePermissions).values(add.map((p) => ({ roleId: role!.id, permissionKey: p })));
      } else if (existing.length === 0) {
        const perms = def.permissions.filter((p) => companyPermissionKeys.includes(p));
        if (perms.length) await tx.insert(rolePermissions).values(perms.map((p) => ({ roleId: role!.id, permissionKey: p })));
      }
    }

    for (const [type, values] of Object.entries(LOOKUPS)) {
      await tx.insert(lookupValues).values(values.map(([key, label], i) => ({ type: type as never, key, label, sortOrder: i }))).onConflictDoNothing();
    }
    await tx.insert(ratingCategories).values(RATING_CATEGORIES.map(([key, label], i) => ({ key, label, sortOrder: i }))).onConflictDoNothing();

    // Company platform list starts from the platform-wide catalogue; each company then edits its own copy.
    const catalog = await tx.select().from(platformCatalog).where(eq(platformCatalog.active, true));
    const have = new Set((await tx.select({ name: platforms.name }).from(platforms)).map((p) => p.name.toLowerCase()));
    const missing = catalog.filter((c) => !have.has(c.name.toLowerCase()));
    if (missing.length) await tx.insert(platforms).values(missing.map((c) => ({ name: c.name, kind: c.kind, catalogId: c.id })));

    await tx.insert(systemSettings).values(Object.entries(DEFAULT_SETTINGS).map(([key, value]) => ({ key, value }))).onConflictDoNothing();

    const [active] = await tx.select({ id: workflowDefinitions.id }).from(workflowDefinitions).where(eq(workflowDefinitions.isActive, true));
    if (!active) {
      const [def] = await tx.insert(workflowDefinitions).values({ name: DEFAULT_WORKFLOW_NAME, version: 1, isActive: true, initialStageKey: INITIAL_STAGE })
        .returning({ id: workflowDefinitions.id });
      await tx.insert(workflowStages).values(DEFAULT_STAGES.map((s, i) => ({
        definitionId: def!.id, key: s.key, name: s.name, category: s.category, badge: s.badge,
        isTerminal: s.isTerminal ?? false, requiresOwner: s.requiresOwner ?? true, sortOrder: i,
      })));
      await tx.insert(workflowTransitions).values(DEFAULT_TRANSITIONS.map((t) => ({
        definitionId: def!.id, fromStageKey: t.from, toStageKey: t.to, action: t.action, requiredPermission: t.permission,
        allowedRoleKeys: t.roles ?? null, requiresCurrentOwner: t.requiresCurrentOwner ?? true,
        requiresRemarks: t.requiresRemarks ?? false, requiresRejectionReason: t.requiresRejectionReason ?? false,
        requiresRecipient: t.requiresRecipient ?? false, recipientRoleKeys: t.recipientRoles ?? null,
        requiresChangeTypes: t.requiresChangeTypes ?? false, requiresPlatform: t.requiresPlatform ?? false,
        isApproval: t.isApproval ?? false,
      })));
    }
  });
}

/** Role ids by key inside the current company (helper for invitations). */
export async function roleIdsByKey(db: Db, keys: string[]) {
  return db.select({ id: roles.id, key: roles.key }).from(roles).where(and(inArray(roles.key, keys.length ? keys : ["-"])));
}
