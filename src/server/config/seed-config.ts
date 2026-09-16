/**
 * Default configuration values used when provisioning a company (see modules/tenancy/provision.ts).
 * Contains NO people, creators or pitches. Company admins can change all of it afterwards.
 */
import type { Db } from "@/server/db/client";

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

/**
 * Single-company convenience for scripts and tests: platform catalogue + one company's defaults.
 * `platformDb` is the identity connection, `companyDb` a company-scoped handle.
 */
export async function seedConfig(platformDb: Db, companyDb: Db): Promise<void> {
  const { seedPlatform, ensureCompanyDefaults } = await import("@/server/modules/tenancy/provision");
  await seedPlatform(platformDb);
  await ensureCompanyDefaults(companyDb);
}
