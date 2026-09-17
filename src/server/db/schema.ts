/**
 * Database schema — single source of truth for tables, constraints and indexes.
 * Immutability triggers and role grants live in the hand-written SQL migration
 * `drizzle/*_integrity.sql` because they cannot be expressed here.
 *
 * Conventions:
 *  - UUID primary keys (non-sequential, safe to expose)
 *  - created_at / updated_at on mutable tables; append-only tables have created_at only
 *  - archived_at for soft deletion; the app DB role has no DELETE on business tables
 *  - money in integer paise (bigint)
 */
import { sql } from "drizzle-orm";
import {
  pgTable, pgEnum, uuid, text, varchar, integer, bigint, boolean, timestamp, date, jsonb,
  index, uniqueIndex, check, primaryKey, inet, smallint, customType,
} from "drizzle-orm/pg-core";

const bytea = customType<{ data: Buffer }>({ dataType: () => "bytea" });

const id = () => uuid("id").primaryKey().default(sql`gen_random_uuid()`);
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();
const archivedAt = () => timestamp("archived_at", { withTimezone: true });
/**
 * Owning company. The database fills it from the transaction-local tenant context (app_company_id())
 * and row-level security rejects any other value, so application code never needs to (and must not) pass it.
 */
const companyId = () => uuid("company_id").notNull().default(sql`public.app_company_id()`);

/* ───────────────────────────── Enums ───────────────────────────── */

export const userStatus = pgEnum("user_status", ["ACTIVE", "DISABLED", "PENDING_VERIFICATION", "INVITED", "SUSPENDED"]);
export const companyStatus = pgEnum("company_status", ["PENDING_SETUP", "TRIAL", "ACTIVE", "SUSPENDED", "EXPIRED", "ARCHIVED"]);
export const subscriptionStatus = pgEnum("subscription_status", ["TRIAL", "ACTIVE", "PAST_DUE", "SUSPENDED", "EXPIRED", "CANCELLED"]);
export const accountScope = pgEnum("account_scope", ["PLATFORM", "COMPANY"]);
export const permissionScope = pgEnum("permission_scope", ["PLATFORM", "COMPANY"]);
export const confidentiality = pgEnum("confidentiality_level", ["STANDARD", "CONFIDENTIAL", "RESTRICTED"]);
export const priority = pgEnum("priority", ["LOW", "MEDIUM", "HIGH", "URGENT"]);
export const creatorType = pgEnum("creator_type", ["WRITER", "DIRECTOR", "WRITER_DIRECTOR", "PRODUCER", "CREATOR", "OTHER"]);
export const lookupType = pgEnum("lookup_type", [
  "GENRE", "SUB_GENRE", "LANGUAGE", "FORMAT", "REJECTION_CATEGORY", "CHANGE_REQUEST_TYPE",
  "DOCUMENT_CATEGORY", "IMAGE_CATEGORY", "BUDGET_RANGE", "TARGET_AUDIENCE", "PITCH_METHOD",
]);
export const stageCategory = pgEnum("stage_category", [
  "INTAKE", "REVIEW", "EXECUTIVE", "PLATFORM", "DEVELOPMENT", "PRODUCTION", "PAUSED", "TERMINAL",
]);
export const workflowAction = pgEnum("workflow_action", [
  "SUBMIT", "ASSIGN", "FORWARD", "ACCEPT", "REJECT", "REQUEST_CHANGES", "HOLD", "RESUME", "APPROVE",
  "SEND_TO_PLATFORM", "SEND_BACK", "RECORD_PLATFORM_PITCH", "MARK_PLATFORM_APPROVED",
  "MARK_READY_FOR_DEVELOPMENT", "START_DEVELOPMENT", "GREENLIGHT", "ADVANCE", "REOPEN",
]);
export const participantReason = pgEnum("participant_reason", [
  "CREATED", "ASSIGNED", "REVIEWED", "PLATFORM_OWNER", "DEVELOPMENT_OWNER", "PRODUCTION_OWNER", "GRANTED",
]);
export const scanStatus = pgEnum("scan_status", ["PENDING", "CLEAN", "INFECTED", "FAILED", "NOT_SCANNED"]);
export const uploadKind = pgEnum("upload_kind", ["DOCUMENT", "IMAGE", "CREATOR_PHOTO"]);
export const accessAction = pgEnum("document_access_action", ["VIEW", "DOWNLOAD"]);
export const platformStatus = pgEnum("platform_status", [
  "NOT_YET_PITCHED", "PITCHED", "AWAITING_RESPONSE", "INTERESTED", "MEETING_REQUESTED", "REQUESTED_CHANGES",
  "SECOND_DRAFT_REQUESTED", "APPROVED", "REJECTED", "ON_HOLD", "DEVELOPMENT_DISCUSSION",
  "READY_FOR_DEVELOPMENT", "GREENLIT",
]);
export const developmentStatus = pgEnum("development_status", [
  "READY_FOR_DEVELOPMENT", "DEVELOPMENT_STARTED", "SCRIPT_DEVELOPMENT", "CASTING_DEVELOPMENT",
  "PACKAGING", "AWAITING_APPROVAL", "DEVELOPMENT_COMPLETED",
]);
export const productionStatus = pgEnum("production_status", [
  "GREENLIT", "PRE_PRODUCTION", "PRODUCTION", "POST_PRODUCTION", "COMPLETED", "RELEASED",
]);
export const jobStatus = pgEnum("job_status", ["PENDING", "RUNNING", "DONE", "FAILED"]);
export const creatorPortalStatus = pgEnum("creator_portal_status", ["ACTIVE", "DISABLED"]);

/* ───────────────────────── Identity & access ───────────────────────── */

export const users = pgTable("users", {
  id: id(),
  email: varchar("email", { length: 254 }).notNull(),           // stored lower-cased
  fullName: varchar("full_name", { length: 120 }).notNull(),
  passwordHash: text("password_hash"),                           // argon2id; null for SSO-only users
  status: userStatus("status").notNull().default("ACTIVE"),
  mfaSecretEnc: bytea("mfa_secret_enc"),                         // AES-256-GCM encrypted TOTP secret
  mfaEnabled: boolean("mfa_enabled").notNull().default(false),
  mfaLastStep: bigint("mfa_last_step", { mode: "number" }),        // TOTP replay protection
  mfaPendingSecretEnc: bytea("mfa_pending_secret_enc"),          // during enrolment, before confirmation
  failedLoginCount: integer("failed_login_count").notNull().default(0),
  lockedUntil: timestamp("locked_until", { withTimezone: true }),
  passwordChangedAt: timestamp("password_changed_at", { withTimezone: true }),
  lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
  clearance: confidentiality("clearance").notNull().default("CONFIDENTIAL"),
  createdAt: createdAt(), updatedAt: updatedAt(), archivedAt: archivedAt(),
  // PLATFORM accounts (Super Admin) have no company; COMPANY accounts always have one (DB check constraint).
  companyId: uuid("company_id").default(sql`public.app_company_id()`),
  scope: accountScope("scope").notNull().default("COMPANY"),
  firstName: varchar("first_name", { length: 60 }),
  lastName: varchar("last_name", { length: 60 }),
  mobileE164: varchar("mobile_e164", { length: 16 }),
  profileImageKey: text("profile_image_key"),
  department: varchar("department", { length: 120 }),
  designation: varchar("designation", { length: 120 }),
  employeeCode: varchar("employee_code", { length: 40 }),
  joiningDate: date("joining_date"),
  disabledAt: timestamp("disabled_at", { withTimezone: true }),
}, (t) => [
  uniqueIndex("users_email_uq").on(t.email),
  check("users_email_lower_ck", sql`${t.email} = lower(${t.email})`),
]);

export const sessions = pgTable("sessions", {
  id: id(),
  userId: uuid("user_id").notNull().references(() => users.id),
  tokenHash: bytea("token_hash").notNull(),                      // HMAC-SHA256(pepper, token); raw token only in cookie
  mfaVerified: boolean("mfa_verified").notNull().default(false),
  createdAt: createdAt(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  ip: inet("ip"),
  userAgent: varchar("user_agent", { length: 512 }),
}, (t) => [
  uniqueIndex("sessions_token_hash_uq").on(t.tokenHash),
  index("sessions_user_idx").on(t.userId),
]);

export const passwordResetTokens = pgTable("password_reset_tokens", {
  id: id(),
  userId: uuid("user_id").notNull().references(() => users.id),
  tokenHash: bytea("token_hash").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
  createdAt: createdAt(),
}, (t) => [uniqueIndex("password_reset_token_hash_uq").on(t.tokenHash)]);

export const loginAttempts = pgTable("login_attempts", {
  id: id(),
  emailHash: bytea("email_hash").notNull(),                      // hashed so the table holds no raw emails
  ip: inet("ip"),
  success: boolean("success").notNull(),
  createdAt: createdAt(),
}, (t) => [
  index("login_attempts_ip_time_idx").on(t.ip, t.createdAt),
  index("login_attempts_email_time_idx").on(t.emailHash, t.createdAt),
]);

export const roles = pgTable("roles", {
  companyId: companyId(),
  id: id(),
  key: varchar("key", { length: 50 }).notNull(),                 // COMPANY_ADMIN, ADMIN, EMPLOYEE, ...
  name: varchar("name", { length: 80 }).notNull(),
  description: text("description"),
  isSystem: boolean("is_system").notNull().default(false),        // system roles cannot be deleted
  createdAt: createdAt(), updatedAt: updatedAt(),
}, (t) => [uniqueIndex("roles_company_key_uq").on(t.companyId, t.key)]);

export const permissions = pgTable("permissions", {
  key: varchar("key", { length: 60 }).primaryKey(),              // e.g. "pitch.reject"
  description: text("description").notNull(),
  scope: permissionScope("scope").notNull().default("COMPANY"),
});

export const rolePermissions = pgTable("role_permissions", {
  companyId: companyId(),
  roleId: uuid("role_id").notNull().references(() => roles.id),
  permissionKey: varchar("permission_key", { length: 60 }).notNull().references(() => permissions.key),
}, (t) => [primaryKey({ columns: [t.roleId, t.permissionKey] })]);

export const userRoles = pgTable("user_roles", {
  companyId: companyId(),
  userId: uuid("user_id").notNull().references(() => users.id),
  roleId: uuid("role_id").notNull().references(() => roles.id),
  grantedById: uuid("granted_by_id").references(() => users.id),
  createdAt: createdAt(),
}, (t) => [primaryKey({ columns: [t.userId, t.roleId] })]);

/* ─────────────────────────── Configuration ─────────────────────────── */

export const lookupValues = pgTable("lookup_values", {
  companyId: companyId(),
  id: id(),
  type: lookupType("type").notNull(),
  key: varchar("key", { length: 60 }).notNull(),
  label: varchar("label", { length: 120 }).notNull(),
  parentKey: varchar("parent_key", { length: 60 }),              // e.g. sub-genre → genre
  sortOrder: integer("sort_order").notNull().default(0),
  active: boolean("active").notNull().default(true),
  createdAt: createdAt(), updatedAt: updatedAt(),
}, (t) => [uniqueIndex("lookup_company_type_key_uq").on(t.companyId, t.type, t.key)]);

export const ratingCategories = pgTable("rating_categories", {
  companyId: companyId(),
  id: id(),
  key: varchar("key", { length: 60 }).notNull(),
  label: varchar("label", { length: 120 }).notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  active: boolean("active").notNull().default(true),
  createdAt: createdAt(), updatedAt: updatedAt(),
}, (t) => [uniqueIndex("rating_categories_company_key_uq").on(t.companyId, t.key)]);

export const systemSettings = pgTable("system_settings", {
  companyId: companyId(),
  key: varchar("key", { length: 80 }).notNull(),
  value: jsonb("value").notNull(),
  updatedById: uuid("updated_by_id").references(() => users.id),
  updatedAt: updatedAt(),
}, (t) => [primaryKey({ columns: [t.companyId, t.key] })]);

/* ───────────────────────────── Workflow ───────────────────────────── */

export const workflowDefinitions = pgTable("workflow_definitions", {
  companyId: companyId(),
  id: id(),
  name: varchar("name", { length: 120 }).notNull(),
  version: integer("version").notNull(),
  isActive: boolean("is_active").notNull().default(false),
  initialStageKey: varchar("initial_stage_key", { length: 60 }).notNull(),
  createdById: uuid("created_by_id").references(() => users.id),
  createdAt: createdAt(),
}, (t) => [
  uniqueIndex("workflow_def_company_version_uq").on(t.companyId, t.name, t.version),
  uniqueIndex("workflow_def_company_one_active_uq").on(t.companyId).where(sql`${t.isActive} = true`),
]);

export const workflowStages = pgTable("workflow_stages", {
  companyId: companyId(),
  id: id(),
  definitionId: uuid("definition_id").notNull().references(() => workflowDefinitions.id),
  key: varchar("key", { length: 60 }).notNull(),
  name: varchar("name", { length: 120 }).notNull(),
  category: stageCategory("category").notNull(),
  badge: varchar("badge", { length: 40 }),                        // UI hint: under_review, approved, ready_to_go...
  isTerminal: boolean("is_terminal").notNull().default(false),
  requiresOwner: boolean("requires_owner").notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),
}, (t) => [uniqueIndex("workflow_stage_def_key_uq").on(t.definitionId, t.key)]);

export const workflowTransitions = pgTable("workflow_transitions", {
  companyId: companyId(),
  id: id(),
  definitionId: uuid("definition_id").notNull().references(() => workflowDefinitions.id),
  fromStageKey: varchar("from_stage_key", { length: 60 }).notNull(),
  // null = "return to the stage recorded when the pitch was paused" (HOLD / REQUEST_CHANGES → RESUME)
  toStageKey: varchar("to_stage_key", { length: 60 }),
  action: workflowAction("action").notNull(),
  requiredPermission: varchar("required_permission", { length: 60 }).notNull().references(() => permissions.key),
  allowedRoleKeys: text("allowed_role_keys").array(),             // null = any role holding the permission
  requiresCurrentOwner: boolean("requires_current_owner").notNull().default(true),
  requiresRemarks: boolean("requires_remarks").notNull().default(false),
  requiresRejectionReason: boolean("requires_rejection_reason").notNull().default(false),
  requiresRecipient: boolean("requires_recipient").notNull().default(false),
  recipientRoleKeys: text("recipient_role_keys").array(),
  requiresChangeTypes: boolean("requires_change_types").notNull().default(false),
  requiresPlatform: boolean("requires_platform").notNull().default(false),
  isApproval: boolean("is_approval").notNull().default(false),    // subject to self-approval policy
}, (t) => [
  uniqueIndex("workflow_transition_uq").on(t.definitionId, t.fromStageKey, t.action, sql`coalesce(${t.toStageKey}, '')`),
]);

/* ─────────────────────────────── Creators ─────────────────────────────── */

export const creators = pgTable("creators", {
  companyId: companyId(),
  id: id(),
  creatorType: creatorType("creator_type").notNull(),
  fullName: varchar("full_name", { length: 120 }).notNull(),
  nameNormalized: varchar("name_normalized", { length: 120 }).notNull(),
  mobileE164: varchar("mobile_e164", { length: 16 }),
  emailNormalized: varchar("email_normalized", { length: 254 }),
  profileImageKey: text("profile_image_key"),                     // private storage key, never a public URL
  location: varchar("location", { length: 120 }),
  languageKeys: text("language_keys").array().notNull().default(sql`'{}'::text[]`),
  yearsExperience: smallint("years_experience"),
  bio: text("bio"),
  agency: varchar("agency", { length: 160 }),
  previousCompanies: text("previous_companies").array().notNull().default(sql`'{}'::text[]`),
  socialLinks: jsonb("social_links").notNull().default(sql`'[]'::jsonb`), // stored & displayed only, never fetched server-side
  website: varchar("website", { length: 500 }),
  notes: text("notes"),
  consentBasis: varchar("consent_basis", { length: 60 }),          // e.g. SUBMISSION_AGREEMENT
  consentRecordedAt: timestamp("consent_recorded_at", { withTimezone: true }),
  createdById: uuid("created_by_id").references(() => users.id),   // null for a self-registered creator portal account
  createdAt: createdAt(), updatedAt: updatedAt(), archivedAt: archivedAt(),

  /* ─── Creator portal (self-service registration/login) ───
   * A self-registered creator authenticates as the `pitch_creator` DB role (see CreatorPool), never as `pitch_app`.
   * These columns mirror the equivalent staff columns on `users` and get the identical defense-in-depth: RLS plus
   * a guard trigger stop `pitch_app` (company staff) from ever reading or writing them. */
  selfRegistered: boolean("self_registered").notNull().default(false),
  passwordHash: text("password_hash"),
  passwordChangedAt: timestamp("password_changed_at", { withTimezone: true }),
  lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
  failedLoginCount: integer("failed_login_count").notNull().default(0),
  lockedUntil: timestamp("locked_until", { withTimezone: true }),
  portalStatus: creatorPortalStatus("portal_status").notNull().default("ACTIVE"),
  /** "New pitch" stays hidden in the portal until this is set (first-time onboarding gate). */
  profileCompletedAt: timestamp("profile_completed_at", { withTimezone: true }),
}, (t) => [
  uniqueIndex("creators_company_mobile_uq").on(t.companyId, t.mobileE164).where(sql`${t.mobileE164} IS NOT NULL`),
  uniqueIndex("creators_company_email_uq").on(t.companyId, t.emailNormalized).where(sql`${t.emailNormalized} IS NOT NULL`),
  index("creators_name_trgm_idx").using("gin", sql`${t.nameNormalized} gin_trgm_ops`),
  check("creators_mobile_format_ck", sql`${t.mobileE164} IS NULL OR ${t.mobileE164} ~ '^\\+[1-9][0-9]{7,14}$'`),
  check("creators_years_ck", sql`${t.yearsExperience} IS NULL OR ${t.yearsExperience} BETWEEN 0 AND 80`),
  // Exactly one authorship path: staff-created (created_by_id) XOR self-registered through the portal.
  check("creators_author_ck", sql`(${t.createdById} IS NOT NULL) <> ${t.selfRegistered}`),
  // A self-registered creator must have both an email (their login identifier) and a password.
  check("creators_portal_identity_ck", sql`NOT ${t.selfRegistered} OR (${t.emailNormalized} IS NOT NULL AND ${t.passwordHash} IS NOT NULL)`),
]);

/** Sessions for the creator portal — a distinct DB role/table from staff `sessions`, never shared. */
export const creatorSessions = pgTable("creator_sessions", {
  companyId: companyId(),
  id: id(),
  creatorId: uuid("creator_id").notNull().references(() => creators.id),
  tokenHash: bytea("token_hash").notNull(),
  createdAt: createdAt(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  ip: inet("ip"),
  userAgent: varchar("user_agent", { length: 512 }),
}, (t) => [
  uniqueIndex("creator_sessions_token_hash_uq").on(t.tokenHash),
  index("creator_sessions_creator_idx").on(t.creatorId),
]);

export const creatorProjects = pgTable("creator_projects", {
  companyId: companyId(),
  id: id(),
  creatorId: uuid("creator_id").notNull().references(() => creators.id),
  projectName: varchar("project_name", { length: 200 }).notNull(),
  role: creatorType("role").notNull(),
  productionCompany: varchar("production_company", { length: 160 }),
  platformName: varchar("platform_name", { length: 120 }),
  releaseYear: smallint("release_year"),
  languageKey: varchar("language_key", { length: 60 }),
  genreKey: varchar("genre_key", { length: 60 }),
  projectStatus: varchar("project_status", { length: 60 }),
  posterKey: text("poster_key"),
  description: text("description"),
  externalLinks: jsonb("external_links").notNull().default(sql`'[]'::jsonb`),
  createdById: uuid("created_by_id").notNull().references(() => users.id),
  createdAt: createdAt(), updatedAt: updatedAt(), archivedAt: archivedAt(),
}, (t) => [
  index("creator_projects_creator_idx").on(t.creatorId),
  check("creator_projects_year_ck", sql`${t.releaseYear} IS NULL OR ${t.releaseYear} BETWEEN 1900 AND 2100`),
]);

/* ─────────────────────────────── Pitches ─────────────────────────────── */

export const pitches = pgTable("pitches", {
  companyId: companyId(),
  id: id(),
  pitchCode: varchar("pitch_code", { length: 32 }).notNull(),     // display only, e.g. PT-2026-000123
  title: varchar("title", { length: 200 }).notNull(),
  logline: varchar("logline", { length: 500 }),
  shortSynopsis: text("short_synopsis"),
  detailedSynopsis: text("detailed_synopsis"),
  genreKey: varchar("genre_key", { length: 60 }),
  subGenreKey: varchar("sub_genre_key", { length: 60 }),
  formatKey: varchar("format_key", { length: 60 }).notNull(),
  languageKey: varchar("language_key", { length: 60 }).notNull(),
  episodeCount: smallint("episode_count"),
  episodeDurationMin: smallint("episode_duration_min"),
  budgetRangeKey: varchar("budget_range_key", { length: 60 }),
  targetAudience: varchar("target_audience", { length: 200 }),
  priority: priority("priority").notNull().default("MEDIUM"),
  confidentiality: confidentiality("confidentiality").notNull().default("CONFIDENTIAL"),
  tags: text("tags").array().notNull().default(sql`'{}'::text[]`),
  notes: text("notes"),
  creatorId: uuid("creator_id").notNull().references(() => creators.id),
  createdById: uuid("created_by_id").references(() => users.id),
  createdByCreatorId: uuid("created_by_creator_id").references(() => creators.id), // set when submitted through the creator portal
  submittedViaPortal: boolean("submitted_via_portal").notNull().default(false),

  // Workflow projection — written ONLY by the workflow engine, in the same transaction as a workflow_event.
  workflowDefinitionId: uuid("workflow_definition_id").notNull().references(() => workflowDefinitions.id),
  currentStageKey: varchar("current_stage_key", { length: 60 }).notNull(),
  currentOwnerId: uuid("current_owner_id").references(() => users.id),
  stageEnteredAt: timestamp("stage_entered_at", { withTimezone: true }).notNull().defaultNow(),
  pausedFromStageKey: varchar("paused_from_stage_key", { length: 60 }),
  lastEventSeq: integer("last_event_seq").notNull().default(0),
  version: integer("version").notNull().default(1),               // optimistic concurrency

  createdAt: createdAt(), updatedAt: updatedAt(), archivedAt: archivedAt(),
  archivedById: uuid("archived_by_id").references(() => users.id),
}, (t) => [
  uniqueIndex("pitches_company_code_uq").on(t.companyId, t.pitchCode),
  index("pitches_stage_idx").on(t.currentStageKey, t.stageEnteredAt),
  index("pitches_owner_idx").on(t.currentOwnerId),
  index("pitches_creator_idx").on(t.creatorId),
  index("pitches_facets_idx").on(t.languageKey, t.genreKey, t.formatKey),
  index("pitches_created_idx").on(t.createdAt),
  index("pitches_title_trgm_idx").using("gin", sql`${t.title} gin_trgm_ops`),
  check("pitches_episodes_ck", sql`${t.episodeCount} IS NULL OR ${t.episodeCount} BETWEEN 1 AND 1000`),
  check("pitches_duration_ck", sql`${t.episodeDurationMin} IS NULL OR ${t.episodeDurationMin} BETWEEN 1 AND 600`),
  // Exactly one author (staff or portal creator), and submitted_via_portal must agree with which one.
  check("pitches_author_ck", sql`(${t.createdById} IS NOT NULL) <> (${t.createdByCreatorId} IS NOT NULL)
    AND ${t.submittedViaPortal} = (${t.createdByCreatorId} IS NOT NULL)`),
]);

export const pitchParticipants = pgTable("pitch_participants", {
  companyId: companyId(),
  pitchId: uuid("pitch_id").notNull().references(() => pitches.id),
  userId: uuid("user_id").notNull().references(() => users.id),
  reason: participantReason("reason").notNull(),
  grantedById: uuid("granted_by_id").references(() => users.id),
  createdAt: createdAt(),
}, (t) => [
  primaryKey({ columns: [t.pitchId, t.userId, t.reason] }),
  index("pitch_participants_user_idx").on(t.userId),
]);

/** Append-only journey of a pitch. UPDATE/DELETE blocked by trigger and grants. */
export const workflowEvents = pgTable("workflow_events", {
  companyId: companyId(),
  id: id(),
  pitchId: uuid("pitch_id").notNull().references(() => pitches.id),
  seq: integer("seq").notNull(),
  action: workflowAction("action").notNull(),
  fromStageKey: varchar("from_stage_key", { length: 60 }),
  toStageKey: varchar("to_stage_key", { length: 60 }).notNull(),
  actorId: uuid("actor_id").references(() => users.id),
  actorCreatorId: uuid("actor_creator_id").references(() => creators.id), // the portal SUBMIT event has no staff actor
  fromOwnerId: uuid("from_owner_id").references(() => users.id),
  toOwnerId: uuid("to_owner_id").references(() => users.id),
  remarks: text("remarks"),
  recommendation: text("recommendation"),
  rejectionCategoryKey: varchar("rejection_category_key", { length: 60 }),
  rejectionReason: text("rejection_reason"),
  changeTypeKeys: text("change_type_keys").array(),
  approvalType: varchar("approval_type", { length: 40 }),         // CEO | COO
  recommendedPlatformIds: uuid("recommended_platform_ids").array(),
  platformId: uuid("platform_id").references(() => platforms.id),
  metadata: jsonb("metadata").notNull().default(sql`'{}'::jsonb`),
  createdAt: createdAt(),
}, (t) => [
  uniqueIndex("workflow_events_pitch_seq_uq").on(t.pitchId, t.seq),
  index("workflow_events_actor_idx").on(t.actorId, t.createdAt),
  index("workflow_events_action_idx").on(t.action, t.createdAt),
  check("workflow_events_seq_ck", sql`${t.seq} >= 1`),
  // Business rule 1: a rejection MUST carry a category and a real reason.
  check("workflow_events_reject_reason_ck", sql`${t.action} <> 'REJECT' OR (
    ${t.rejectionCategoryKey} IS NOT NULL AND ${t.rejectionReason} IS NOT NULL
    AND char_length(btrim(${t.rejectionReason})) >= 10)`),
  // Business rule 2: a forward MUST record sender and recipient.
  check("workflow_events_forward_ck", sql`${t.action} <> 'FORWARD' OR ${t.toOwnerId} IS NOT NULL`),
  // Business rule 19: platform approval must name the platform.
  check("workflow_events_platform_approval_ck", sql`${t.action} <> 'MARK_PLATFORM_APPROVED' OR ${t.platformId} IS NOT NULL`),
  // Exactly one actor: staff (via the workflow engine) or a portal creator (only ever the initial SUBMIT).
  check("workflow_events_author_ck", sql`(${t.actorId} IS NOT NULL) <> (${t.actorCreatorId} IS NOT NULL)`),
]);

/* ─────────────────────── Documents, versions, images ─────────────────────── */

export const documents = pgTable("documents", {
  companyId: companyId(),
  id: id(),
  pitchId: uuid("pitch_id").notNull().references(() => pitches.id),
  categoryKey: varchar("category_key", { length: 60 }).notNull(), // SCRIPT, SYNOPSIS, PITCH_DECK...
  title: varchar("title", { length: 200 }).notNull(),
  currentVersionId: uuid("current_version_id"),                   // FK added in integrity migration (circular)
  createdById: uuid("created_by_id").references(() => users.id),
  createdByCreatorId: uuid("created_by_creator_id").references(() => creators.id),
  createdAt: createdAt(), updatedAt: updatedAt(), archivedAt: archivedAt(),
}, (t) => [
  index("documents_pitch_idx").on(t.pitchId, t.categoryKey),
  check("documents_author_ck", sql`(${t.createdById} IS NOT NULL) <> (${t.createdByCreatorId} IS NOT NULL)`),
]);

/** Append-only. A new script upload is always a new row. */
export const documentVersions = pgTable("document_versions", {
  companyId: companyId(),
  id: id(),
  documentId: uuid("document_id").notNull().references(() => documents.id),
  versionNo: integer("version_no").notNull(),
  storageKey: text("storage_key").notNull(),                      // server-generated, no user input in path
  originalFilename: varchar("original_filename", { length: 255 }).notNull(), // sanitized, display only
  detectedMime: varchar("detected_mime", { length: 100 }).notNull(), // from magic bytes, not browser
  sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
  sha256: varchar("sha256", { length: 64 }).notNull(),
  scanStatus: scanStatus("scan_status").notNull().default("PENDING"),
  versionLabel: varchar("version_label", { length: 60 }),          // e.g. "Second draft for Netflix"
  notes: text("notes"),
  uploadedById: uuid("uploaded_by_id").references(() => users.id),
  uploadedByCreatorId: uuid("uploaded_by_creator_id").references(() => creators.id),
  createdAt: createdAt(),
}, (t) => [
  uniqueIndex("document_versions_doc_version_uq").on(t.documentId, t.versionNo),
  uniqueIndex("document_versions_storage_key_uq").on(t.storageKey),
  check("document_versions_size_ck", sql`${t.sizeBytes} > 0`),
  check("document_versions_version_ck", sql`${t.versionNo} >= 1`),
  check("document_versions_author_ck", sql`(${t.uploadedById} IS NOT NULL) <> (${t.uploadedByCreatorId} IS NOT NULL)`),
]);

/** Scan results arrive after upload; kept separate so document_versions stays immutable. */
export const documentScanResults = pgTable("document_scan_results", {
  companyId: companyId(),
  id: id(),
  documentVersionId: uuid("document_version_id").notNull().references(() => documentVersions.id),
  status: scanStatus("status").notNull(),
  engine: varchar("engine", { length: 60 }),
  detail: text("detail"),
  createdAt: createdAt(),
}, (t) => [index("document_scan_results_version_idx").on(t.documentVersionId, t.createdAt)]);

export const pitchImages = pgTable("pitch_images", {
  companyId: companyId(),
  id: id(),
  pitchId: uuid("pitch_id").notNull().references(() => pitches.id),
  categoryKey: varchar("category_key", { length: 60 }).notNull(),
  caption: varchar("caption", { length: 300 }),
  storageKey: text("storage_key").notNull(),
  detectedMime: varchar("detected_mime", { length: 100 }).notNull(),
  sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
  sha256: varchar("sha256", { length: 64 }).notNull(),
  scanStatus: scanStatus("scan_status").notNull().default("PENDING"),
  uploadedById: uuid("uploaded_by_id").notNull().references(() => users.id),
  createdAt: createdAt(), archivedAt: archivedAt(),
}, (t) => [
  index("pitch_images_pitch_idx").on(t.pitchId),
  uniqueIndex("pitch_images_storage_key_uq").on(t.storageKey),
  check("pitch_images_mime_ck", sql`${t.detectedMime} IN ('image/jpeg','image/png','image/webp')`),
]);

/** Append-only: "Who downloaded this script?" */
export const documentAccessLogs = pgTable("document_access_logs", {
  companyId: companyId(),
  id: id(),
  documentVersionId: uuid("document_version_id").notNull().references(() => documentVersions.id),
  pitchId: uuid("pitch_id").notNull().references(() => pitches.id),
  userId: uuid("user_id").references(() => users.id),
  creatorId: uuid("creator_id").references(() => creators.id), // a portal creator viewing/downloading their own script
  action: accessAction("action").notNull(),
  ip: inet("ip"),
  userAgent: varchar("user_agent", { length: 512 }),
  createdAt: createdAt(),
}, (t) => [
  index("document_access_logs_version_idx").on(t.documentVersionId, t.createdAt),
  index("document_access_logs_user_idx").on(t.userId, t.createdAt),
  check("document_access_logs_actor_ck", sql`(${t.userId} IS NOT NULL) <> (${t.creatorId} IS NOT NULL)`),
]);

/* ─────────────────────────────── Ratings ─────────────────────────────── */

/** Append-only; a creator's rating is always computed, never overwritten. */
export const ratings = pgTable("ratings", {
  companyId: companyId(),
  id: id(),
  creatorId: uuid("creator_id").notNull().references(() => creators.id),
  pitchId: uuid("pitch_id").notNull().references(() => pitches.id),
  reviewerId: uuid("reviewer_id").notNull().references(() => users.id),
  workflowEventId: uuid("workflow_event_id").references(() => workflowEvents.id),
  overall: smallint("overall").notNull(),
  comments: text("comments"),
  createdAt: createdAt(),
}, (t) => [
  index("ratings_creator_idx").on(t.creatorId, t.createdAt),
  index("ratings_pitch_idx").on(t.pitchId),
  uniqueIndex("ratings_event_reviewer_uq").on(t.workflowEventId, t.reviewerId).where(sql`${t.workflowEventId} IS NOT NULL`),
  check("ratings_overall_ck", sql`${t.overall} BETWEEN 1 AND 5`),
]);

export const ratingScores = pgTable("rating_scores", {
  companyId: companyId(),
  ratingId: uuid("rating_id").notNull().references(() => ratings.id),
  categoryId: uuid("category_id").notNull().references(() => ratingCategories.id),
  score: smallint("score").notNull(),
}, (t) => [
  primaryKey({ columns: [t.ratingId, t.categoryId] }),
  check("rating_scores_score_ck", sql`${t.score} BETWEEN 1 AND 5`),
]);

/* ─────────────────────────────── Platforms ─────────────────────────────── */

export const platforms = pgTable("platforms", {
  companyId: companyId(),
  id: id(),
  name: varchar("name", { length: 120 }).notNull(),
  kind: varchar("kind", { length: 40 }).notNull().default("OTT"), // OTT | BROADCAST | AVOD | OTHER
  languageKeys: text("language_keys").array().notNull().default(sql`'{}'::text[]`),
  genreKeys: text("genre_keys").array().notNull().default(sql`'{}'::text[]`),
  preferences: text("preferences"),
  notes: text("notes"),
  active: boolean("active").notNull().default(true),
  catalogId: uuid("catalog_id").references(() => platformCatalog.id),
  createdAt: createdAt(), updatedAt: updatedAt(),
}, (t) => [uniqueIndex("platforms_company_name_uq").on(t.companyId, sql`lower(${t.name})`)]);

export const platformContacts = pgTable("platform_contacts", {
  companyId: companyId(),
  id: id(),
  platformId: uuid("platform_id").notNull().references(() => platforms.id),
  fullName: varchar("full_name", { length: 120 }).notNull(),
  designation: varchar("designation", { length: 120 }),
  department: varchar("department", { length: 120 }),
  email: varchar("email", { length: 254 }),
  mobileE164: varchar("mobile_e164", { length: 16 }),
  notes: text("notes"),
  active: boolean("active").notNull().default(true),
  createdAt: createdAt(), updatedAt: updatedAt(),
}, (t) => [index("platform_contacts_platform_idx").on(t.platformId)]);

export const platformPitches = pgTable("platform_pitches", {
  companyId: companyId(),
  id: id(),
  pitchId: uuid("pitch_id").notNull().references(() => pitches.id),
  platformId: uuid("platform_id").notNull().references(() => platforms.id),
  roundNo: smallint("round_no").notNull().default(1),
  pitchedById: uuid("pitched_by_id").notNull().references(() => users.id),
  contactId: uuid("contact_id").references(() => platformContacts.id),
  pitchDate: date("pitch_date").notNull(),
  methodKey: varchar("method_key", { length: 60 }),
  materialsSent: jsonb("materials_sent").notNull().default(sql`'[]'::jsonb`),
  scriptVersionId: uuid("script_version_id").references(() => documentVersions.id),
  deckVersionId: uuid("deck_version_id").references(() => documentVersions.id),
  remarks: text("remarks"),
  currentStatus: platformStatus("current_status").notNull().default("PITCHED"), // projection of responses
  nextFollowUpOn: date("next_follow_up_on"),
  createdAt: createdAt(), updatedAt: updatedAt(),
}, (t) => [
  uniqueIndex("platform_pitches_round_uq").on(t.pitchId, t.platformId, t.roundNo),
  index("platform_pitches_platform_status_idx").on(t.platformId, t.currentStatus),
]);

/** Append-only platform response history. */
export const platformResponses = pgTable("platform_responses", {
  companyId: companyId(),
  id: id(),
  platformPitchId: uuid("platform_pitch_id").notNull().references(() => platformPitches.id),
  status: platformStatus("status").notNull(),
  responseDate: date("response_date").notNull(),
  notes: text("notes"),
  recordedById: uuid("recorded_by_id").notNull().references(() => users.id),
  createdAt: createdAt(),
}, (t) => [index("platform_responses_pp_idx").on(t.platformPitchId, t.createdAt)]);

export const followUps = pgTable("follow_ups", {
  companyId: companyId(),
  id: id(),
  platformPitchId: uuid("platform_pitch_id").notNull().references(() => platformPitches.id),
  assigneeId: uuid("assignee_id").notNull().references(() => users.id),
  dueOn: date("due_on").notNull(),
  note: text("note"),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  outcome: text("outcome"),
  createdById: uuid("created_by_id").notNull().references(() => users.id),
  createdAt: createdAt(), updatedAt: updatedAt(),
}, (t) => [index("follow_ups_due_open_idx").on(t.dueOn).where(sql`${t.completedAt} IS NULL`)]);

/* ───────────────────────── Development & production ───────────────────────── */

export const developmentProjects = pgTable("development_projects", {
  companyId: companyId(),
  id: id(),
  pitchId: uuid("pitch_id").notNull().references(() => pitches.id),
  platformPitchId: uuid("platform_pitch_id").references(() => platformPitches.id),
  ownerId: uuid("owner_id").notNull().references(() => users.id),
  startDate: date("start_date"),
  expectedCompletion: date("expected_completion"),
  status: developmentStatus("status").notNull().default("READY_FOR_DEVELOPMENT"),
  requirements: text("requirements"),
  notes: text("notes"),
  createdAt: createdAt(), updatedAt: updatedAt(),
}, (t) => [uniqueIndex("development_projects_pitch_uq").on(t.pitchId)]);

export const developmentUpdates = pgTable("development_updates", {
  companyId: companyId(),
  id: id(),
  developmentProjectId: uuid("development_project_id").notNull().references(() => developmentProjects.id),
  status: developmentStatus("status").notNull(),
  kind: varchar("kind", { length: 40 }).notNull(),                // NOTE | MEETING | PLATFORM_FEEDBACK | STATUS
  body: text("body"),
  meetingAt: timestamp("meeting_at", { withTimezone: true }),
  authorId: uuid("author_id").notNull().references(() => users.id),
  createdAt: createdAt(),
}, (t) => [index("development_updates_project_idx").on(t.developmentProjectId, t.createdAt)]);

export const productionProjects = pgTable("production_projects", {
  companyId: companyId(),
  id: id(),
  pitchId: uuid("pitch_id").notNull().references(() => pitches.id),
  ownerId: uuid("owner_id").notNull().references(() => users.id),
  productionCompany: varchar("production_company", { length: 160 }),
  platformId: uuid("platform_id").references(() => platforms.id),
  startDate: date("start_date"),
  expectedRelease: date("expected_release"),
  actualRelease: date("actual_release"),
  budgetPaise: bigint("budget_paise", { mode: "bigint" }),
  status: productionStatus("status").notNull().default("GREENLIT"),
  notes: text("notes"),
  createdAt: createdAt(), updatedAt: updatedAt(),
}, (t) => [
  uniqueIndex("production_projects_pitch_uq").on(t.pitchId),
  check("production_budget_ck", sql`${t.budgetPaise} IS NULL OR ${t.budgetPaise} >= 0`),
]);

export const productionUpdates = pgTable("production_updates", {
  companyId: companyId(),
  id: id(),
  productionProjectId: uuid("production_project_id").notNull().references(() => productionProjects.id),
  status: productionStatus("status").notNull(),
  body: text("body"),
  authorId: uuid("author_id").notNull().references(() => users.id),
  createdAt: createdAt(),
}, (t) => [index("production_updates_project_idx").on(t.productionProjectId, t.createdAt)]);

/* ───────────────────────────── Operational ───────────────────────────── */

export const notifications = pgTable("notifications", {
  companyId: companyId(),
  id: id(),
  userId: uuid("user_id").notNull().references(() => users.id),
  type: varchar("type", { length: 60 }).notNull(),
  title: varchar("title", { length: 200 }).notNull(),             // never contains script content
  pitchId: uuid("pitch_id").references(() => pitches.id),
  readAt: timestamp("read_at", { withTimezone: true }),
  createdAt: createdAt(),
}, (t) => [index("notifications_user_idx").on(t.userId, t.readAt, t.createdAt)]);

export const jobOutbox = pgTable("job_outbox", {
  companyId: companyId(),
  id: id(),
  type: varchar("type", { length: 60 }).notNull(),
  payload: jsonb("payload").notNull(),
  status: jobStatus("status").notNull().default("PENDING"),
  attempts: integer("attempts").notNull().default(0),
  runAfter: timestamp("run_after", { withTimezone: true }).notNull().defaultNow(),
  lastError: text("last_error"),
  createdAt: createdAt(), updatedAt: updatedAt(),
}, (t) => [index("job_outbox_pending_idx").on(t.runAfter).where(sql`${t.status} = 'PENDING'`)]);

/** Append-only audit trail. App role: INSERT + SELECT only. */
export const auditLogs = pgTable("audit_logs", {
  companyId: uuid("company_id"),                                // null only for platform-level events
  id: id(),
  actorId: uuid("actor_id").references(() => users.id),           // null for anonymous (failed login)
  action: varchar("action", { length: 80 }).notNull(),
  resourceType: varchar("resource_type", { length: 60 }).notNull(),
  resourceId: uuid("resource_id"),
  before: jsonb("before"),
  after: jsonb("after"),
  ip: inet("ip"),
  userAgent: varchar("user_agent", { length: 512 }),
  requestId: varchar("request_id", { length: 64 }),
  createdAt: createdAt(),
}, (t) => [
  index("audit_logs_resource_idx").on(t.resourceType, t.resourceId, t.createdAt),
  index("audit_logs_actor_idx").on(t.actorId, t.createdAt),
  index("audit_logs_action_idx").on(t.action, t.createdAt),
]);

export const savedFilters = pgTable("saved_filters", {
  companyId: companyId(),
  id: id(),
  userId: uuid("user_id").notNull().references(() => users.id),
  name: varchar("name", { length: 120 }).notNull(),
  scope: varchar("scope", { length: 40 }).notNull().default("PITCHES"),
  query: jsonb("query").notNull(),                                // validated against filter schema before save & use
  createdAt: createdAt(), updatedAt: updatedAt(),
}, (t) => [uniqueIndex("saved_filters_user_name_uq").on(t.userId, t.name)]);

export const pitchCodeCounters = pgTable("pitch_code_counters", {
  companyId: companyId(),
  year: smallint("year").notNull(),
  lastValue: integer("last_value").notNull().default(0),
}, (t) => [primaryKey({ columns: [t.companyId, t.year] })]);

/**
 * A server-issued permission to upload exactly one object to a server-chosen quarantine key.
 * Nothing becomes downloadable until /complete validates the bytes and records a version.
 */
export const uploadIntents = pgTable("upload_intents", {
  companyId: companyId(),
  id: id(),
  kind: uploadKind("kind").notNull(),
  pitchId: uuid("pitch_id").references(() => pitches.id),
  documentId: uuid("document_id").references(() => documents.id),   // set when uploading a new version
  creatorId: uuid("creator_id").references(() => creators.id),
  categoryKey: varchar("category_key", { length: 60 }),
  title: varchar("title", { length: 200 }),
  caption: varchar("caption", { length: 300 }),
  versionLabel: varchar("version_label", { length: 60 }),
  notes: text("notes"),
  originalFilename: varchar("original_filename", { length: 255 }).notNull(),
  declaredSizeBytes: bigint("declared_size_bytes", { mode: "number" }).notNull(),
  quarantineKey: text("quarantine_key").notNull(),
  createdById: uuid("created_by_id").references(() => users.id),   // null when issued to a creator-portal account
  createdByCreatorId: uuid("created_by_creator_id").references(() => creators.id),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  rejectedReason: varchar("rejected_reason", { length: 200 }),
  createdAt: createdAt(),
}, (t) => [
  uniqueIndex("upload_intents_key_uq").on(t.quarantineKey),
  index("upload_intents_user_idx").on(t.createdById, t.createdAt),
  check("upload_intents_target_ck", sql`(${t.kind} = 'CREATOR_PHOTO' AND ${t.creatorId} IS NOT NULL) OR (${t.kind} <> 'CREATOR_PHOTO' AND ${t.pitchId} IS NOT NULL)`),
  check("upload_intents_author_ck", sql`(${t.createdById} IS NOT NULL) <> (${t.createdByCreatorId} IS NOT NULL)`),
]);

/* ───────────────────────────── Multi-tenant platform ───────────────────────────── */

export const companies = pgTable("companies", {
  id: id(),
  code: varchar("code", { length: 12 }).notNull(),
  name: varchar("name", { length: 160 }).notNull(),
  legalName: varchar("legal_name", { length: 200 }),
  pitchCodePrefix: varchar("pitch_code_prefix", { length: 12 }),
  logoKey: text("logo_key"),
  faviconKey: text("favicon_key"),
  brandPrimaryColor: varchar("brand_primary_color", { length: 7 }),
  website: varchar("website", { length: 500 }),
  industry: varchar("industry", { length: 120 }),
  country: varchar("country", { length: 80 }),
  state: varchar("state", { length: 80 }),
  city: varchar("city", { length: 80 }),
  address: text("address"),
  contactPerson: varchar("contact_person", { length: 120 }),
  contactPhone: varchar("contact_phone", { length: 20 }),
  primaryEmail: varchar("primary_email", { length: 254 }),
  status: companyStatus("status").notNull().default("PENDING_SETUP"),
  statusReason: varchar("status_reason", { length: 300 }),
  retentionDays: integer("retention_days").notNull().default(365),
  setupCompletedAt: timestamp("setup_completed_at", { withTimezone: true }),
  suspendedAt: timestamp("suspended_at", { withTimezone: true }),
  archivedAt: archivedAt(),
  createdById: uuid("created_by_id"),
  createdAt: createdAt(), updatedAt: updatedAt(),
  /** Hashed like every other bearer token here; the raw token is shown to the Company Admin once and never stored.
   *  Regenerating it (a fresh hash) invalidates old copies of the link without touching already-registered creators. */
  creatorPortalTokenHash: bytea("creator_portal_token_hash"),
}, (t) => [
  uniqueIndex("companies_code_uq").on(t.code),
  uniqueIndex("companies_creator_portal_token_hash_uq").on(t.creatorPortalTokenHash).where(sql`${t.creatorPortalTokenHash} IS NOT NULL`),
]);

export const plans = pgTable("plans", {
  key: varchar("key", { length: 40 }).primaryKey(),
  name: varchar("name", { length: 80 }).notNull(),
  description: text("description"),
  limits: jsonb("limits").notNull().default(sql`'{}'::jsonb`),
  active: boolean("active").notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: createdAt(), updatedAt: updatedAt(),
});

export const subscriptions = pgTable("subscriptions", {
  id: id(),
  companyId: uuid("company_id").notNull().references(() => companies.id),
  planKey: varchar("plan_key", { length: 40 }).notNull().references(() => plans.key),
  status: subscriptionStatus("status").notNull().default("TRIAL"),
  startsOn: date("starts_on").notNull().default(sql`CURRENT_DATE`),
  endsOn: date("ends_on"),
  limitOverrides: jsonb("limit_overrides").notNull().default(sql`'{}'::jsonb`),
  externalProvider: varchar("external_provider", { length: 40 }),
  externalRef: varchar("external_ref", { length: 120 }),
  createdAt: createdAt(), updatedAt: updatedAt(),
}, (t) => [uniqueIndex("subscriptions_company_uq").on(t.companyId)]);

export const subscriptionEvents = pgTable("subscription_events", {
  id: id(),
  companyId: uuid("company_id").notNull().references(() => companies.id),
  event: varchar("event", { length: 60 }).notNull(),
  before: jsonb("before"),
  after: jsonb("after"),
  actorId: uuid("actor_id"),
  createdAt: createdAt(),
});

export const usageRecords = pgTable("usage_records", {
  id: id(),
  companyId: uuid("company_id").notNull().references(() => companies.id),
  period: date("period").notNull(),
  metric: varchar("metric", { length: 40 }).notNull(),
  value: bigint("value", { mode: "number" }).notNull(),
  createdAt: createdAt(),
}, (t) => [uniqueIndex("usage_records_uq").on(t.companyId, t.period, t.metric)]);

export const supportAccessGrants = pgTable("support_access_grants", {
  id: id(),
  companyId: uuid("company_id").notNull().references(() => companies.id),
  platformUserId: uuid("platform_user_id").notNull().references(() => users.id),
  reason: varchar("reason", { length: 500 }).notNull(),
  startsAt: timestamp("starts_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  createdAt: createdAt(),
});

export const companyEmailDomains = pgTable("company_email_domains", {
  companyId: uuid("company_id").notNull().references(() => companies.id),
  domain: varchar("domain", { length: 253 }).notNull(),
  createdAt: createdAt(),
}, (t) => [primaryKey({ columns: [t.companyId, t.domain] })]);

export const companyAllowedEmails = pgTable("company_allowed_emails", {
  companyId: uuid("company_id").notNull().default(sql`public.app_company_id()`).references(() => companies.id),
  email: varchar("email", { length: 254 }).notNull(),
  reason: varchar("reason", { length: 300 }),
  approvedById: uuid("approved_by_id"),
  createdAt: createdAt(),
}, (t) => [primaryKey({ columns: [t.companyId, t.email] })]);

export const platformCatalog = pgTable("platform_catalog", {
  id: id(),
  name: varchar("name", { length: 120 }).notNull(),
  kind: varchar("kind", { length: 40 }).notNull().default("OTT"),
  active: boolean("active").notNull().default(true),
  createdAt: createdAt(),
});

export const userInvitations = pgTable("user_invitations", {
  id: id(),
  companyId: uuid("company_id").notNull().default(sql`public.app_company_id()`),
  userId: uuid("user_id").notNull(),
  tokenHash: bytea("token_hash").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  invitedById: uuid("invited_by_id"),
  createdAt: createdAt(),
}, (t) => [uniqueIndex("user_invitations_token_uq").on(t.tokenHash)]);
