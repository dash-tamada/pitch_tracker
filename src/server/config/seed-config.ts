/**
 * Idempotent configuration seed — safe for every environment including production.
 * Contains NO people, creators or pitches. Admins can change all of it afterwards.
 */
import { eq } from "drizzle-orm";
import type { Db } from "@/server/db/client";
import {
  lookupValues, permissions, platforms, ratingCategories, rolePermissions, roles, systemSettings,
  workflowDefinitions, workflowStages, workflowTransitions,
} from "@/server/db/schema";
import { DEFAULT_ROLE_MATRIX, PERMISSIONS, ROLE_KEYS } from "@/server/modules/authz/permissions";
import { DEFAULT_STAGES, DEFAULT_TRANSITIONS, DEFAULT_WORKFLOW_NAME, INITIAL_STAGE } from "./default-workflow";

type LookupSeed = Record<string, [key: string, label: string][]>;

export const LOOKUPS: LookupSeed = {
  FORMAT: [["FEATURE_FILM", "Feature Film"], ["WEB_SERIES", "Web Series"], ["TV_SERIES", "TV Series"], ["SHORT_FILM", "Short Film"],
    ["DOCUMENTARY", "Documentary"], ["REALITY", "Reality"], ["OTHER", "Other"]],
  LANGUAGE: [["TELUGU", "Telugu"], ["HINDI", "Hindi"], ["TAMIL", "Tamil"], ["KANNADA", "Kannada"], ["MALAYALAM", "Malayalam"],
    ["ENGLISH", "English"], ["OTHER", "Other"]],
  GENRE: [["DRAMA", "Drama"], ["THRILLER", "Thriller"], ["CRIME", "Crime"], ["COMEDY", "Comedy"], ["ROMANCE", "Romance"],
    ["ACTION", "Action"], ["HORROR", "Horror"], ["FAMILY", "Family"], ["MYTHOLOGY", "Mythology"], ["SCI_FI", "Sci-Fi"],
    ["FANTASY", "Fantasy"], ["DOCUMENTARY", "Documentary"], ["OTHER", "Other"]],
  REJECTION_CATEGORY: [["WEAK_STORY", "Weak Story"], ["WEAK_SCREENPLAY", "Weak Screenplay"], ["POOR_EXECUTION", "Poor Execution"],
    ["NOT_COMMERCIALLY_VIABLE", "Not Commercially Viable"], ["NOT_SUITABLE_FOR_SLATE", "Not Suitable for Current Slate"],
    ["BUDGET_CONCERN", "Budget Concern"], ["CASTING_CONCERN", "Casting Concern"], ["PLATFORM_MISMATCH", "Platform Mismatch"],
    ["SIMILAR_EXISTING_CONTENT", "Similar Existing Content"], ["CREATOR_CONCERN", "Creator Concern"],
    ["NOT_SUITABLE_FOR_LANGUAGE", "Not Suitable for Language"], ["NOT_SUITABLE_FOR_GENRE", "Not Suitable for Genre"], ["OTHER", "Other"]],
  CHANGE_REQUEST_TYPE: [["SCRIPT", "Script changes"], ["SYNOPSIS", "Synopsis changes"], ["CHARACTER", "Character changes"],
    ["STRUCTURE", "Structure changes"], ["BUDGET", "Budget changes"], ["OTHER", "Other"]],
  DOCUMENT_CATEGORY: [["SCRIPT", "Script"], ["SYNOPSIS", "Synopsis"], ["ONE_LINE", "One-line"], ["CHARACTER_DOC", "Character document"],
    ["DIRECTORS_NOTE", "Director's note"], ["PITCH_DECK", "Pitch deck"], ["PRESENTATION", "Presentation"],
    ["REFERENCE", "Reference material"], ["POSTER", "Poster"], ["OTHER", "Other"]],
  IMAGE_CATEGORY: [["STORY_REFERENCE", "Story reference"], ["CHARACTER_REFERENCE", "Character reference"],
    ["LOCATION_REFERENCE", "Location reference"], ["MOOD_BOARD", "Mood board"], ["POSTER", "Poster"], ["CONCEPT_ART", "Concept art"],
    ["PITCH_DECK_IMAGE", "Pitch deck image"], ["OTHER", "Other"]],
  BUDGET_RANGE: [["UNDER_1CR", "Under ₹1 Cr"], ["1_5CR", "₹1–5 Cr"], ["5_15CR", "₹5–15 Cr"], ["15_50CR", "₹15–50 Cr"], ["ABOVE_50CR", "Above ₹50 Cr"]],
  PITCH_METHOD: [["EMAIL", "Email"], ["IN_PERSON", "In-person meeting"], ["VIDEO_CALL", "Video call"], ["PORTAL", "Platform portal"], ["OTHER", "Other"]],
};

export const RATING_CATEGORIES: [string, string][] = [
  ["STORY_QUALITY", "Story Quality"], ["SCREENPLAY_QUALITY", "Screenplay Quality"], ["ORIGINALITY", "Originality"],
  ["COMMERCIAL_POTENTIAL", "Commercial Potential"], ["EXECUTION", "Execution"], ["PROFESSIONALISM", "Professionalism"],
];

/** Initial platform list as supplied in the requirements. Editable/disable-able by Admin. */
export const SEED_PLATFORMS = ["aha", "ETV Win", "ZEE5", "Netflix", "Amazon Prime Video", "JioHotstar", "Sony LIV", "Sun NXT", "Amazon MX Player", "YouTube"];

export const DEFAULT_SETTINGS: Record<string, unknown> = {
  allow_self_approval: false,
  executive_approval_mode: "ANY",
  ratings_visibility: "MANAGEMENT",
  aging_thresholds_days: { attention: 3, overdue: 7, critical: 14 },
};

export async function seedConfig(db: Db): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.insert(permissions).values(Object.entries(PERMISSIONS).map(([key, description]) => ({ key, description }))).onConflictDoNothing();

    for (const key of ROLE_KEYS) {
      const def = DEFAULT_ROLE_MATRIX[key];
      await tx.insert(roles).values({ key, name: def.name, isSystem: true }).onConflictDoNothing();
      const [role] = await tx.select({ id: roles.id }).from(roles).where(eq(roles.key, key));
      // Only seed permissions for a role that has none yet — never overwrite an Admin's edits.
      const existing = await tx.select({ k: rolePermissions.permissionKey }).from(rolePermissions).where(eq(rolePermissions.roleId, role!.id)).limit(1);
      if (existing.length === 0) {
        await tx.insert(rolePermissions).values(def.permissions.map((p) => ({ roleId: role!.id, permissionKey: p })));
      }
    }

    for (const [type, values] of Object.entries(LOOKUPS)) {
      await tx.insert(lookupValues).values(values.map(([key, label], i) => ({ type: type as never, key, label, sortOrder: i }))).onConflictDoNothing();
    }
    await tx.insert(ratingCategories).values(RATING_CATEGORIES.map(([key, label], i) => ({ key, label, sortOrder: i }))).onConflictDoNothing();

    const existingPlatforms = await tx.select({ name: platforms.name }).from(platforms);
    const have = new Set(existingPlatforms.map((p) => p.name.toLowerCase()));
    const missing = SEED_PLATFORMS.filter((n) => !have.has(n.toLowerCase()));
    if (missing.length) await tx.insert(platforms).values(missing.map((name) => ({ name, kind: name === "YouTube" ? "AVOD" : "OTT" })));

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

