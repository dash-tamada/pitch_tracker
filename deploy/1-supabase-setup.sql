BEGIN;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='pitch_app') THEN CREATE ROLE pitch_app LOGIN NOINHERIT; END IF; END $$;
-- ===== 0000_init =====
DO $$
BEGIN
  -- Supabase keeps extensions in the "extensions" schema (not exposed by its Data API); plain PostgreSQL uses the default.
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'extensions') THEN
    CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA extensions;
    -- Make gin_trgm_ops resolvable for the trigram indexes below, whatever the migrating role's default search_path is.
    PERFORM set_config('search_path', 'public, extensions', true);
  ELSE
    CREATE EXTENSION IF NOT EXISTS pg_trgm;
  END IF;
END $$;
CREATE TYPE "public"."document_access_action" AS ENUM('VIEW', 'DOWNLOAD');
CREATE TYPE "public"."confidentiality_level" AS ENUM('STANDARD', 'CONFIDENTIAL', 'RESTRICTED');
CREATE TYPE "public"."creator_type" AS ENUM('WRITER', 'DIRECTOR', 'WRITER_DIRECTOR', 'PRODUCER', 'CREATOR', 'OTHER');
CREATE TYPE "public"."development_status" AS ENUM('READY_FOR_DEVELOPMENT', 'DEVELOPMENT_STARTED', 'SCRIPT_DEVELOPMENT', 'CASTING_DEVELOPMENT', 'PACKAGING', 'AWAITING_APPROVAL', 'DEVELOPMENT_COMPLETED');
CREATE TYPE "public"."job_status" AS ENUM('PENDING', 'RUNNING', 'DONE', 'FAILED');
CREATE TYPE "public"."lookup_type" AS ENUM('GENRE', 'SUB_GENRE', 'LANGUAGE', 'FORMAT', 'REJECTION_CATEGORY', 'CHANGE_REQUEST_TYPE', 'DOCUMENT_CATEGORY', 'IMAGE_CATEGORY', 'BUDGET_RANGE', 'TARGET_AUDIENCE', 'PITCH_METHOD');
CREATE TYPE "public"."participant_reason" AS ENUM('CREATED', 'ASSIGNED', 'REVIEWED', 'PLATFORM_OWNER', 'DEVELOPMENT_OWNER', 'PRODUCTION_OWNER', 'GRANTED');
CREATE TYPE "public"."platform_status" AS ENUM('NOT_YET_PITCHED', 'PITCHED', 'AWAITING_RESPONSE', 'INTERESTED', 'MEETING_REQUESTED', 'REQUESTED_CHANGES', 'SECOND_DRAFT_REQUESTED', 'APPROVED', 'REJECTED', 'ON_HOLD', 'DEVELOPMENT_DISCUSSION', 'READY_FOR_DEVELOPMENT', 'GREENLIT');
CREATE TYPE "public"."priority" AS ENUM('LOW', 'MEDIUM', 'HIGH', 'URGENT');
CREATE TYPE "public"."production_status" AS ENUM('GREENLIT', 'PRE_PRODUCTION', 'PRODUCTION', 'POST_PRODUCTION', 'COMPLETED', 'RELEASED');
CREATE TYPE "public"."scan_status" AS ENUM('PENDING', 'CLEAN', 'INFECTED', 'FAILED');
CREATE TYPE "public"."stage_category" AS ENUM('INTAKE', 'REVIEW', 'EXECUTIVE', 'PLATFORM', 'DEVELOPMENT', 'PRODUCTION', 'PAUSED', 'TERMINAL');
CREATE TYPE "public"."user_status" AS ENUM('ACTIVE', 'DISABLED', 'PENDING_VERIFICATION');
CREATE TYPE "public"."workflow_action" AS ENUM('SUBMIT', 'ASSIGN', 'FORWARD', 'ACCEPT', 'REJECT', 'REQUEST_CHANGES', 'HOLD', 'RESUME', 'APPROVE', 'SEND_TO_PLATFORM', 'SEND_BACK', 'RECORD_PLATFORM_PITCH', 'MARK_PLATFORM_APPROVED', 'MARK_READY_FOR_DEVELOPMENT', 'START_DEVELOPMENT', 'GREENLIGHT', 'ADVANCE', 'REOPEN');
CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_id" uuid,
	"action" varchar(80) NOT NULL,
	"resource_type" varchar(60) NOT NULL,
	"resource_id" uuid,
	"before" jsonb,
	"after" jsonb,
	"ip" "inet",
	"user_agent" varchar(512),
	"request_id" varchar(64),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "creator_projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"creator_id" uuid NOT NULL,
	"project_name" varchar(200) NOT NULL,
	"role" "creator_type" NOT NULL,
	"production_company" varchar(160),
	"platform_name" varchar(120),
	"release_year" smallint,
	"language_key" varchar(60),
	"genre_key" varchar(60),
	"project_status" varchar(60),
	"poster_key" text,
	"description" text,
	"external_links" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_by_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "creator_projects_year_ck" CHECK ("creator_projects"."release_year" IS NULL OR "creator_projects"."release_year" BETWEEN 1900 AND 2100)
);

CREATE TABLE "creators" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"creator_type" "creator_type" NOT NULL,
	"full_name" varchar(120) NOT NULL,
	"name_normalized" varchar(120) NOT NULL,
	"mobile_e164" varchar(16),
	"email_normalized" varchar(254),
	"profile_image_key" text,
	"location" varchar(120),
	"language_keys" text[] DEFAULT '{}'::text[] NOT NULL,
	"years_experience" smallint,
	"bio" text,
	"agency" varchar(160),
	"previous_companies" text[] DEFAULT '{}'::text[] NOT NULL,
	"social_links" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"website" varchar(500),
	"notes" text,
	"consent_basis" varchar(60),
	"consent_recorded_at" timestamp with time zone,
	"created_by_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "creators_mobile_format_ck" CHECK ("creators"."mobile_e164" IS NULL OR "creators"."mobile_e164" ~ '^\+[1-9][0-9]{7,14}$'),
	CONSTRAINT "creators_years_ck" CHECK ("creators"."years_experience" IS NULL OR "creators"."years_experience" BETWEEN 0 AND 80)
);

CREATE TABLE "development_projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pitch_id" uuid NOT NULL,
	"platform_pitch_id" uuid,
	"owner_id" uuid NOT NULL,
	"start_date" date,
	"expected_completion" date,
	"status" "development_status" DEFAULT 'READY_FOR_DEVELOPMENT' NOT NULL,
	"requirements" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "development_updates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"development_project_id" uuid NOT NULL,
	"status" "development_status" NOT NULL,
	"kind" varchar(40) NOT NULL,
	"body" text,
	"meeting_at" timestamp with time zone,
	"author_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "document_access_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_version_id" uuid NOT NULL,
	"pitch_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"action" "document_access_action" NOT NULL,
	"ip" "inet",
	"user_agent" varchar(512),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "document_scan_results" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_version_id" uuid NOT NULL,
	"status" "scan_status" NOT NULL,
	"engine" varchar(60),
	"detail" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "document_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"version_no" integer NOT NULL,
	"storage_key" text NOT NULL,
	"original_filename" varchar(255) NOT NULL,
	"detected_mime" varchar(100) NOT NULL,
	"size_bytes" bigint NOT NULL,
	"sha256" varchar(64) NOT NULL,
	"scan_status" "scan_status" DEFAULT 'PENDING' NOT NULL,
	"version_label" varchar(60),
	"notes" text,
	"uploaded_by_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "document_versions_size_ck" CHECK ("document_versions"."size_bytes" > 0),
	CONSTRAINT "document_versions_version_ck" CHECK ("document_versions"."version_no" >= 1)
);

CREATE TABLE "documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pitch_id" uuid NOT NULL,
	"category_key" varchar(60) NOT NULL,
	"title" varchar(200) NOT NULL,
	"current_version_id" uuid,
	"created_by_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone
);

CREATE TABLE "follow_ups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"platform_pitch_id" uuid NOT NULL,
	"assignee_id" uuid NOT NULL,
	"due_on" date NOT NULL,
	"note" text,
	"completed_at" timestamp with time zone,
	"outcome" text,
	"created_by_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "job_outbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" varchar(60) NOT NULL,
	"payload" jsonb NOT NULL,
	"status" "job_status" DEFAULT 'PENDING' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"run_after" timestamp with time zone DEFAULT now() NOT NULL,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "login_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email_hash" "bytea" NOT NULL,
	"ip" "inet",
	"success" boolean NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "lookup_values" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" "lookup_type" NOT NULL,
	"key" varchar(60) NOT NULL,
	"label" varchar(120) NOT NULL,
	"parent_key" varchar(60),
	"sort_order" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"type" varchar(60) NOT NULL,
	"title" varchar(200) NOT NULL,
	"pitch_id" uuid,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "password_reset_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" "bytea" NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "permissions" (
	"key" varchar(60) PRIMARY KEY NOT NULL,
	"description" text NOT NULL
);

CREATE TABLE "pitch_code_counters" (
	"year" smallint PRIMARY KEY NOT NULL,
	"last_value" integer DEFAULT 0 NOT NULL
);

CREATE TABLE "pitch_images" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pitch_id" uuid NOT NULL,
	"category_key" varchar(60) NOT NULL,
	"caption" varchar(300),
	"storage_key" text NOT NULL,
	"detected_mime" varchar(100) NOT NULL,
	"size_bytes" bigint NOT NULL,
	"sha256" varchar(64) NOT NULL,
	"scan_status" "scan_status" DEFAULT 'PENDING' NOT NULL,
	"uploaded_by_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "pitch_images_mime_ck" CHECK ("pitch_images"."detected_mime" IN ('image/jpeg','image/png','image/webp'))
);

CREATE TABLE "pitch_participants" (
	"pitch_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"reason" "participant_reason" NOT NULL,
	"granted_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pitch_participants_pitch_id_user_id_reason_pk" PRIMARY KEY("pitch_id","user_id","reason")
);

CREATE TABLE "pitches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pitch_code" varchar(20) NOT NULL,
	"title" varchar(200) NOT NULL,
	"logline" varchar(500),
	"short_synopsis" text,
	"detailed_synopsis" text,
	"genre_key" varchar(60),
	"sub_genre_key" varchar(60),
	"format_key" varchar(60) NOT NULL,
	"language_key" varchar(60) NOT NULL,
	"episode_count" smallint,
	"episode_duration_min" smallint,
	"budget_range_key" varchar(60),
	"target_audience" varchar(200),
	"priority" "priority" DEFAULT 'MEDIUM' NOT NULL,
	"confidentiality" "confidentiality_level" DEFAULT 'CONFIDENTIAL' NOT NULL,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"notes" text,
	"creator_id" uuid NOT NULL,
	"created_by_id" uuid NOT NULL,
	"workflow_definition_id" uuid NOT NULL,
	"current_stage_key" varchar(60) NOT NULL,
	"current_owner_id" uuid,
	"stage_entered_at" timestamp with time zone DEFAULT now() NOT NULL,
	"paused_from_stage_key" varchar(60),
	"last_event_seq" integer DEFAULT 0 NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"archived_by_id" uuid,
	CONSTRAINT "pitches_episodes_ck" CHECK ("pitches"."episode_count" IS NULL OR "pitches"."episode_count" BETWEEN 1 AND 1000),
	CONSTRAINT "pitches_duration_ck" CHECK ("pitches"."episode_duration_min" IS NULL OR "pitches"."episode_duration_min" BETWEEN 1 AND 600)
);

CREATE TABLE "platform_contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"platform_id" uuid NOT NULL,
	"full_name" varchar(120) NOT NULL,
	"designation" varchar(120),
	"department" varchar(120),
	"email" varchar(254),
	"mobile_e164" varchar(16),
	"notes" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "platform_pitches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pitch_id" uuid NOT NULL,
	"platform_id" uuid NOT NULL,
	"round_no" smallint DEFAULT 1 NOT NULL,
	"pitched_by_id" uuid NOT NULL,
	"contact_id" uuid,
	"pitch_date" date NOT NULL,
	"method_key" varchar(60),
	"materials_sent" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"script_version_id" uuid,
	"deck_version_id" uuid,
	"remarks" text,
	"current_status" "platform_status" DEFAULT 'PITCHED' NOT NULL,
	"next_follow_up_on" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "platform_responses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"platform_pitch_id" uuid NOT NULL,
	"status" "platform_status" NOT NULL,
	"response_date" date NOT NULL,
	"notes" text,
	"recorded_by_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "platforms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(120) NOT NULL,
	"kind" varchar(40) DEFAULT 'OTT' NOT NULL,
	"language_keys" text[] DEFAULT '{}'::text[] NOT NULL,
	"genre_keys" text[] DEFAULT '{}'::text[] NOT NULL,
	"preferences" text,
	"notes" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "production_projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pitch_id" uuid NOT NULL,
	"owner_id" uuid NOT NULL,
	"production_company" varchar(160),
	"platform_id" uuid,
	"start_date" date,
	"expected_release" date,
	"actual_release" date,
	"budget_paise" bigint,
	"status" "production_status" DEFAULT 'GREENLIT' NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "production_budget_ck" CHECK ("production_projects"."budget_paise" IS NULL OR "production_projects"."budget_paise" >= 0)
);

CREATE TABLE "production_updates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"production_project_id" uuid NOT NULL,
	"status" "production_status" NOT NULL,
	"body" text,
	"author_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "rating_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" varchar(60) NOT NULL,
	"label" varchar(120) NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "rating_scores" (
	"rating_id" uuid NOT NULL,
	"category_id" uuid NOT NULL,
	"score" smallint NOT NULL,
	CONSTRAINT "rating_scores_rating_id_category_id_pk" PRIMARY KEY("rating_id","category_id"),
	CONSTRAINT "rating_scores_score_ck" CHECK ("rating_scores"."score" BETWEEN 1 AND 5)
);

CREATE TABLE "ratings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"creator_id" uuid NOT NULL,
	"pitch_id" uuid NOT NULL,
	"reviewer_id" uuid NOT NULL,
	"workflow_event_id" uuid,
	"overall" smallint NOT NULL,
	"comments" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ratings_overall_ck" CHECK ("ratings"."overall" BETWEEN 1 AND 5)
);

CREATE TABLE "role_permissions" (
	"role_id" uuid NOT NULL,
	"permission_key" varchar(60) NOT NULL,
	CONSTRAINT "role_permissions_role_id_permission_key_pk" PRIMARY KEY("role_id","permission_key")
);

CREATE TABLE "roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" varchar(50) NOT NULL,
	"name" varchar(80) NOT NULL,
	"description" text,
	"is_system" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "saved_filters" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" varchar(120) NOT NULL,
	"scope" varchar(40) DEFAULT 'PITCHES' NOT NULL,
	"query" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" "bytea" NOT NULL,
	"mfa_verified" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"ip" "inet",
	"user_agent" varchar(512)
);

CREATE TABLE "system_settings" (
	"key" varchar(80) PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_by_id" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "user_roles" (
	"user_id" uuid NOT NULL,
	"role_id" uuid NOT NULL,
	"granted_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_roles_user_id_role_id_pk" PRIMARY KEY("user_id","role_id")
);

CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" varchar(254) NOT NULL,
	"full_name" varchar(120) NOT NULL,
	"password_hash" text,
	"status" "user_status" DEFAULT 'ACTIVE' NOT NULL,
	"mfa_secret_enc" "bytea",
	"mfa_enabled" boolean DEFAULT false NOT NULL,
	"mfa_last_step" bigint,
	"mfa_pending_secret_enc" "bytea",
	"failed_login_count" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"password_changed_at" timestamp with time zone,
	"last_login_at" timestamp with time zone,
	"clearance" "confidentiality_level" DEFAULT 'CONFIDENTIAL' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "users_email_lower_ck" CHECK ("users"."email" = lower("users"."email"))
);

CREATE TABLE "workflow_definitions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(120) NOT NULL,
	"version" integer NOT NULL,
	"is_active" boolean DEFAULT false NOT NULL,
	"initial_stage_key" varchar(60) NOT NULL,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "workflow_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pitch_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"action" "workflow_action" NOT NULL,
	"from_stage_key" varchar(60),
	"to_stage_key" varchar(60) NOT NULL,
	"actor_id" uuid NOT NULL,
	"from_owner_id" uuid,
	"to_owner_id" uuid,
	"remarks" text,
	"recommendation" text,
	"rejection_category_key" varchar(60),
	"rejection_reason" text,
	"change_type_keys" text[],
	"approval_type" varchar(40),
	"recommended_platform_ids" uuid[],
	"platform_id" uuid,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workflow_events_seq_ck" CHECK ("workflow_events"."seq" >= 1),
	CONSTRAINT "workflow_events_reject_reason_ck" CHECK ("workflow_events"."action" <> 'REJECT' OR (
    "workflow_events"."rejection_category_key" IS NOT NULL AND "workflow_events"."rejection_reason" IS NOT NULL
    AND char_length(btrim("workflow_events"."rejection_reason")) >= 10)),
	CONSTRAINT "workflow_events_forward_ck" CHECK ("workflow_events"."action" <> 'FORWARD' OR "workflow_events"."to_owner_id" IS NOT NULL),
	CONSTRAINT "workflow_events_platform_approval_ck" CHECK ("workflow_events"."action" <> 'MARK_PLATFORM_APPROVED' OR "workflow_events"."platform_id" IS NOT NULL)
);

CREATE TABLE "workflow_stages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"definition_id" uuid NOT NULL,
	"key" varchar(60) NOT NULL,
	"name" varchar(120) NOT NULL,
	"category" "stage_category" NOT NULL,
	"badge" varchar(40),
	"is_terminal" boolean DEFAULT false NOT NULL,
	"requires_owner" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL
);

CREATE TABLE "workflow_transitions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"definition_id" uuid NOT NULL,
	"from_stage_key" varchar(60) NOT NULL,
	"to_stage_key" varchar(60),
	"action" "workflow_action" NOT NULL,
	"required_permission" varchar(60) NOT NULL,
	"allowed_role_keys" text[],
	"requires_current_owner" boolean DEFAULT true NOT NULL,
	"requires_remarks" boolean DEFAULT false NOT NULL,
	"requires_rejection_reason" boolean DEFAULT false NOT NULL,
	"requires_recipient" boolean DEFAULT false NOT NULL,
	"recipient_role_keys" text[],
	"requires_change_types" boolean DEFAULT false NOT NULL,
	"requires_platform" boolean DEFAULT false NOT NULL,
	"is_approval" boolean DEFAULT false NOT NULL
);

ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "creator_projects" ADD CONSTRAINT "creator_projects_creator_id_creators_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."creators"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "creator_projects" ADD CONSTRAINT "creator_projects_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "creators" ADD CONSTRAINT "creators_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "development_projects" ADD CONSTRAINT "development_projects_pitch_id_pitches_id_fk" FOREIGN KEY ("pitch_id") REFERENCES "public"."pitches"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "development_projects" ADD CONSTRAINT "development_projects_platform_pitch_id_platform_pitches_id_fk" FOREIGN KEY ("platform_pitch_id") REFERENCES "public"."platform_pitches"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "development_projects" ADD CONSTRAINT "development_projects_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "development_updates" ADD CONSTRAINT "development_updates_development_project_id_development_projects_id_fk" FOREIGN KEY ("development_project_id") REFERENCES "public"."development_projects"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "development_updates" ADD CONSTRAINT "development_updates_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "document_access_logs" ADD CONSTRAINT "document_access_logs_document_version_id_document_versions_id_fk" FOREIGN KEY ("document_version_id") REFERENCES "public"."document_versions"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "document_access_logs" ADD CONSTRAINT "document_access_logs_pitch_id_pitches_id_fk" FOREIGN KEY ("pitch_id") REFERENCES "public"."pitches"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "document_access_logs" ADD CONSTRAINT "document_access_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "document_scan_results" ADD CONSTRAINT "document_scan_results_document_version_id_document_versions_id_fk" FOREIGN KEY ("document_version_id") REFERENCES "public"."document_versions"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "document_versions" ADD CONSTRAINT "document_versions_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "document_versions" ADD CONSTRAINT "document_versions_uploaded_by_id_users_id_fk" FOREIGN KEY ("uploaded_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "documents" ADD CONSTRAINT "documents_pitch_id_pitches_id_fk" FOREIGN KEY ("pitch_id") REFERENCES "public"."pitches"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "documents" ADD CONSTRAINT "documents_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "follow_ups" ADD CONSTRAINT "follow_ups_platform_pitch_id_platform_pitches_id_fk" FOREIGN KEY ("platform_pitch_id") REFERENCES "public"."platform_pitches"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "follow_ups" ADD CONSTRAINT "follow_ups_assignee_id_users_id_fk" FOREIGN KEY ("assignee_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "follow_ups" ADD CONSTRAINT "follow_ups_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_pitch_id_pitches_id_fk" FOREIGN KEY ("pitch_id") REFERENCES "public"."pitches"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "pitch_images" ADD CONSTRAINT "pitch_images_pitch_id_pitches_id_fk" FOREIGN KEY ("pitch_id") REFERENCES "public"."pitches"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "pitch_images" ADD CONSTRAINT "pitch_images_uploaded_by_id_users_id_fk" FOREIGN KEY ("uploaded_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "pitch_participants" ADD CONSTRAINT "pitch_participants_pitch_id_pitches_id_fk" FOREIGN KEY ("pitch_id") REFERENCES "public"."pitches"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "pitch_participants" ADD CONSTRAINT "pitch_participants_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "pitch_participants" ADD CONSTRAINT "pitch_participants_granted_by_id_users_id_fk" FOREIGN KEY ("granted_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "pitches" ADD CONSTRAINT "pitches_creator_id_creators_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."creators"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "pitches" ADD CONSTRAINT "pitches_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "pitches" ADD CONSTRAINT "pitches_workflow_definition_id_workflow_definitions_id_fk" FOREIGN KEY ("workflow_definition_id") REFERENCES "public"."workflow_definitions"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "pitches" ADD CONSTRAINT "pitches_current_owner_id_users_id_fk" FOREIGN KEY ("current_owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "pitches" ADD CONSTRAINT "pitches_archived_by_id_users_id_fk" FOREIGN KEY ("archived_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "platform_contacts" ADD CONSTRAINT "platform_contacts_platform_id_platforms_id_fk" FOREIGN KEY ("platform_id") REFERENCES "public"."platforms"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "platform_pitches" ADD CONSTRAINT "platform_pitches_pitch_id_pitches_id_fk" FOREIGN KEY ("pitch_id") REFERENCES "public"."pitches"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "platform_pitches" ADD CONSTRAINT "platform_pitches_platform_id_platforms_id_fk" FOREIGN KEY ("platform_id") REFERENCES "public"."platforms"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "platform_pitches" ADD CONSTRAINT "platform_pitches_pitched_by_id_users_id_fk" FOREIGN KEY ("pitched_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "platform_pitches" ADD CONSTRAINT "platform_pitches_contact_id_platform_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."platform_contacts"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "platform_pitches" ADD CONSTRAINT "platform_pitches_script_version_id_document_versions_id_fk" FOREIGN KEY ("script_version_id") REFERENCES "public"."document_versions"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "platform_pitches" ADD CONSTRAINT "platform_pitches_deck_version_id_document_versions_id_fk" FOREIGN KEY ("deck_version_id") REFERENCES "public"."document_versions"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "platform_responses" ADD CONSTRAINT "platform_responses_platform_pitch_id_platform_pitches_id_fk" FOREIGN KEY ("platform_pitch_id") REFERENCES "public"."platform_pitches"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "platform_responses" ADD CONSTRAINT "platform_responses_recorded_by_id_users_id_fk" FOREIGN KEY ("recorded_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "production_projects" ADD CONSTRAINT "production_projects_pitch_id_pitches_id_fk" FOREIGN KEY ("pitch_id") REFERENCES "public"."pitches"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "production_projects" ADD CONSTRAINT "production_projects_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "production_projects" ADD CONSTRAINT "production_projects_platform_id_platforms_id_fk" FOREIGN KEY ("platform_id") REFERENCES "public"."platforms"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "production_updates" ADD CONSTRAINT "production_updates_production_project_id_production_projects_id_fk" FOREIGN KEY ("production_project_id") REFERENCES "public"."production_projects"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "production_updates" ADD CONSTRAINT "production_updates_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "rating_scores" ADD CONSTRAINT "rating_scores_rating_id_ratings_id_fk" FOREIGN KEY ("rating_id") REFERENCES "public"."ratings"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "rating_scores" ADD CONSTRAINT "rating_scores_category_id_rating_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."rating_categories"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "ratings" ADD CONSTRAINT "ratings_creator_id_creators_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."creators"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "ratings" ADD CONSTRAINT "ratings_pitch_id_pitches_id_fk" FOREIGN KEY ("pitch_id") REFERENCES "public"."pitches"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "ratings" ADD CONSTRAINT "ratings_reviewer_id_users_id_fk" FOREIGN KEY ("reviewer_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "ratings" ADD CONSTRAINT "ratings_workflow_event_id_workflow_events_id_fk" FOREIGN KEY ("workflow_event_id") REFERENCES "public"."workflow_events"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permission_key_permissions_key_fk" FOREIGN KEY ("permission_key") REFERENCES "public"."permissions"("key") ON DELETE no action ON UPDATE no action;
ALTER TABLE "saved_filters" ADD CONSTRAINT "saved_filters_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "system_settings" ADD CONSTRAINT "system_settings_updated_by_id_users_id_fk" FOREIGN KEY ("updated_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_granted_by_id_users_id_fk" FOREIGN KEY ("granted_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "workflow_definitions" ADD CONSTRAINT "workflow_definitions_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "workflow_events" ADD CONSTRAINT "workflow_events_pitch_id_pitches_id_fk" FOREIGN KEY ("pitch_id") REFERENCES "public"."pitches"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "workflow_events" ADD CONSTRAINT "workflow_events_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "workflow_events" ADD CONSTRAINT "workflow_events_from_owner_id_users_id_fk" FOREIGN KEY ("from_owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "workflow_events" ADD CONSTRAINT "workflow_events_to_owner_id_users_id_fk" FOREIGN KEY ("to_owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "workflow_events" ADD CONSTRAINT "workflow_events_platform_id_platforms_id_fk" FOREIGN KEY ("platform_id") REFERENCES "public"."platforms"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "workflow_stages" ADD CONSTRAINT "workflow_stages_definition_id_workflow_definitions_id_fk" FOREIGN KEY ("definition_id") REFERENCES "public"."workflow_definitions"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "workflow_transitions" ADD CONSTRAINT "workflow_transitions_definition_id_workflow_definitions_id_fk" FOREIGN KEY ("definition_id") REFERENCES "public"."workflow_definitions"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "workflow_transitions" ADD CONSTRAINT "workflow_transitions_required_permission_permissions_key_fk" FOREIGN KEY ("required_permission") REFERENCES "public"."permissions"("key") ON DELETE no action ON UPDATE no action;
CREATE INDEX "audit_logs_resource_idx" ON "audit_logs" USING btree ("resource_type","resource_id","created_at");
CREATE INDEX "audit_logs_actor_idx" ON "audit_logs" USING btree ("actor_id","created_at");
CREATE INDEX "audit_logs_action_idx" ON "audit_logs" USING btree ("action","created_at");
CREATE INDEX "creator_projects_creator_idx" ON "creator_projects" USING btree ("creator_id");
CREATE UNIQUE INDEX "creators_mobile_uq" ON "creators" USING btree ("mobile_e164") WHERE "creators"."mobile_e164" IS NOT NULL;
CREATE UNIQUE INDEX "creators_email_uq" ON "creators" USING btree ("email_normalized") WHERE "creators"."email_normalized" IS NOT NULL;
CREATE INDEX "creators_name_trgm_idx" ON "creators" USING gin ("name_normalized" gin_trgm_ops);
CREATE UNIQUE INDEX "development_projects_pitch_uq" ON "development_projects" USING btree ("pitch_id");
CREATE INDEX "development_updates_project_idx" ON "development_updates" USING btree ("development_project_id","created_at");
CREATE INDEX "document_access_logs_version_idx" ON "document_access_logs" USING btree ("document_version_id","created_at");
CREATE INDEX "document_access_logs_user_idx" ON "document_access_logs" USING btree ("user_id","created_at");
CREATE INDEX "document_scan_results_version_idx" ON "document_scan_results" USING btree ("document_version_id","created_at");
CREATE UNIQUE INDEX "document_versions_doc_version_uq" ON "document_versions" USING btree ("document_id","version_no");
CREATE UNIQUE INDEX "document_versions_storage_key_uq" ON "document_versions" USING btree ("storage_key");
CREATE INDEX "documents_pitch_idx" ON "documents" USING btree ("pitch_id","category_key");
CREATE INDEX "follow_ups_due_open_idx" ON "follow_ups" USING btree ("due_on") WHERE "follow_ups"."completed_at" IS NULL;
CREATE INDEX "job_outbox_pending_idx" ON "job_outbox" USING btree ("run_after") WHERE "job_outbox"."status" = 'PENDING';
CREATE INDEX "login_attempts_ip_time_idx" ON "login_attempts" USING btree ("ip","created_at");
CREATE INDEX "login_attempts_email_time_idx" ON "login_attempts" USING btree ("email_hash","created_at");
CREATE UNIQUE INDEX "lookup_type_key_uq" ON "lookup_values" USING btree ("type","key");
CREATE INDEX "notifications_user_idx" ON "notifications" USING btree ("user_id","read_at","created_at");
CREATE UNIQUE INDEX "password_reset_token_hash_uq" ON "password_reset_tokens" USING btree ("token_hash");
CREATE INDEX "pitch_images_pitch_idx" ON "pitch_images" USING btree ("pitch_id");
CREATE UNIQUE INDEX "pitch_images_storage_key_uq" ON "pitch_images" USING btree ("storage_key");
CREATE INDEX "pitch_participants_user_idx" ON "pitch_participants" USING btree ("user_id");
CREATE UNIQUE INDEX "pitches_code_uq" ON "pitches" USING btree ("pitch_code");
CREATE INDEX "pitches_stage_idx" ON "pitches" USING btree ("current_stage_key","stage_entered_at");
CREATE INDEX "pitches_owner_idx" ON "pitches" USING btree ("current_owner_id");
CREATE INDEX "pitches_creator_idx" ON "pitches" USING btree ("creator_id");
CREATE INDEX "pitches_facets_idx" ON "pitches" USING btree ("language_key","genre_key","format_key");
CREATE INDEX "pitches_created_idx" ON "pitches" USING btree ("created_at");
CREATE INDEX "pitches_title_trgm_idx" ON "pitches" USING gin ("title" gin_trgm_ops);
CREATE INDEX "platform_contacts_platform_idx" ON "platform_contacts" USING btree ("platform_id");
CREATE UNIQUE INDEX "platform_pitches_round_uq" ON "platform_pitches" USING btree ("pitch_id","platform_id","round_no");
CREATE INDEX "platform_pitches_platform_status_idx" ON "platform_pitches" USING btree ("platform_id","current_status");
CREATE INDEX "platform_responses_pp_idx" ON "platform_responses" USING btree ("platform_pitch_id","created_at");
CREATE UNIQUE INDEX "platforms_name_uq" ON "platforms" USING btree (lower("name"));
CREATE UNIQUE INDEX "production_projects_pitch_uq" ON "production_projects" USING btree ("pitch_id");
CREATE INDEX "production_updates_project_idx" ON "production_updates" USING btree ("production_project_id","created_at");
CREATE UNIQUE INDEX "rating_categories_key_uq" ON "rating_categories" USING btree ("key");
CREATE INDEX "ratings_creator_idx" ON "ratings" USING btree ("creator_id","created_at");
CREATE INDEX "ratings_pitch_idx" ON "ratings" USING btree ("pitch_id");
CREATE UNIQUE INDEX "ratings_event_reviewer_uq" ON "ratings" USING btree ("workflow_event_id","reviewer_id") WHERE "ratings"."workflow_event_id" IS NOT NULL;
CREATE UNIQUE INDEX "roles_key_uq" ON "roles" USING btree ("key");
CREATE UNIQUE INDEX "saved_filters_user_name_uq" ON "saved_filters" USING btree ("user_id","name");
CREATE UNIQUE INDEX "sessions_token_hash_uq" ON "sessions" USING btree ("token_hash");
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");
CREATE UNIQUE INDEX "users_email_uq" ON "users" USING btree ("email");
CREATE UNIQUE INDEX "workflow_def_version_uq" ON "workflow_definitions" USING btree ("name","version");
CREATE UNIQUE INDEX "workflow_def_one_active_uq" ON "workflow_definitions" USING btree ("is_active") WHERE "workflow_definitions"."is_active" = true;
CREATE UNIQUE INDEX "workflow_events_pitch_seq_uq" ON "workflow_events" USING btree ("pitch_id","seq");
CREATE INDEX "workflow_events_actor_idx" ON "workflow_events" USING btree ("actor_id","created_at");
CREATE INDEX "workflow_events_action_idx" ON "workflow_events" USING btree ("action","created_at");
CREATE UNIQUE INDEX "workflow_stage_def_key_uq" ON "workflow_stages" USING btree ("definition_id","key");
CREATE UNIQUE INDEX "workflow_transition_uq" ON "workflow_transitions" USING btree ("definition_id","from_stage_key","action",coalesce("to_stage_key", ''));
;
-- ===== 0001_integrity =====
-- Integrity layer: rules that must hold even if the application server is compromised.
-- 1) Append-only tables reject UPDATE/DELETE via triggers.
-- 2) The runtime role `pitch_app` gets the minimum grants (no DDL, no DELETE on business data,
--    INSERT/SELECT only on history tables).
-- The role must exist before migrating (see README → Database roles).

-- Circular FK: documents.current_version_id → document_versions.id
ALTER TABLE "documents"
  ADD CONSTRAINT "documents_current_version_fk"
  FOREIGN KEY ("current_version_id") REFERENCES "document_versions"("id") DEFERRABLE INITIALLY DEFERRED;


CREATE OR REPLACE FUNCTION forbid_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'IMMUTABLE_RECORD: % on % is not permitted', TG_OP, TG_TABLE_NAME
    USING ERRCODE = 'insufficient_privilege';
END;
$$;


CREATE TRIGGER workflow_events_immutable BEFORE UPDATE OR DELETE ON "workflow_events"
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

CREATE TRIGGER platform_responses_immutable BEFORE UPDATE OR DELETE ON "platform_responses"
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

CREATE TRIGGER ratings_immutable BEFORE UPDATE OR DELETE ON "ratings"
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

CREATE TRIGGER rating_scores_immutable BEFORE UPDATE OR DELETE ON "rating_scores"
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

CREATE TRIGGER audit_logs_immutable BEFORE UPDATE OR DELETE ON "audit_logs"
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

CREATE TRIGGER document_access_logs_immutable BEFORE UPDATE OR DELETE ON "document_access_logs"
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

CREATE TRIGGER document_scan_results_immutable BEFORE UPDATE OR DELETE ON "document_scan_results"
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

CREATE TRIGGER development_updates_immutable BEFORE UPDATE OR DELETE ON "development_updates"
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

CREATE TRIGGER production_updates_immutable BEFORE UPDATE OR DELETE ON "production_updates"
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();


-- Script versions: never deleted; the only permitted change is the malware-scan outcome
-- moving out of PENDING exactly once.
CREATE OR REPLACE FUNCTION document_versions_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'IMMUTABLE_RECORD: DELETE on document_versions is not permitted'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF (to_jsonb(NEW) - 'scan_status') IS DISTINCT FROM (to_jsonb(OLD) - 'scan_status')
     OR OLD.scan_status <> 'PENDING' THEN
    RAISE EXCEPTION 'IMMUTABLE_RECORD: document_versions may only change scan_status from PENDING'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER document_versions_guard BEFORE UPDATE OR DELETE ON "document_versions"
  FOR EACH ROW EXECUTE FUNCTION document_versions_guard();


-- Workflow definitions are versioned: stages/transitions of a definition that pitches
-- already use must not be edited in place (Admin publishes a new version instead).
CREATE OR REPLACE FUNCTION workflow_config_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE def_id uuid;
BEGIN
  def_id := COALESCE(OLD.definition_id, NEW.definition_id);
  IF EXISTS (SELECT 1 FROM pitches WHERE workflow_definition_id = def_id) THEN
    RAISE EXCEPTION 'WORKFLOW_IN_USE: definition % is used by pitches; publish a new version', def_id
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER workflow_stages_guard BEFORE UPDATE OR DELETE ON "workflow_stages"
  FOR EACH ROW EXECUTE FUNCTION workflow_config_guard();

CREATE TRIGGER workflow_transitions_guard BEFORE UPDATE OR DELETE ON "workflow_transitions"
  FOR EACH ROW EXECUTE FUNCTION workflow_config_guard();


-- Pitch rows are never hard-deleted (business rule 17).
CREATE TRIGGER pitches_no_delete BEFORE DELETE ON "pitches"
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();


-- Keep updated_at honest regardless of what the application sends.
CREATE OR REPLACE FUNCTION touch_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DO $$
DECLARE t text;
BEGIN
  FOR t IN
    SELECT c.table_name FROM information_schema.columns c
    JOIN information_schema.tables tb ON tb.table_name = c.table_name AND tb.table_schema = c.table_schema
    WHERE c.table_schema = 'public' AND c.column_name = 'updated_at' AND tb.table_type = 'BASE TABLE'
  LOOP
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION touch_updated_at()',
                   t || '_touch_updated_at', t);
  END LOOP;
END $$;


-- ───────────── Least-privilege grants for the runtime role ─────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pitch_app') THEN
    RAISE EXCEPTION 'Role pitch_app must exist before running migrations (see README)';
  END IF;
END $$;

REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC;

GRANT USAGE ON SCHEMA public TO pitch_app;

-- Mutable business tables: read/insert/update, no delete.
GRANT SELECT, INSERT, UPDATE ON
  users, roles, lookup_values, rating_categories, system_settings,
  workflow_definitions, workflow_stages, workflow_transitions,
  creators, creator_projects, pitches, documents, pitch_images,
  platforms, platform_contacts, platform_pitches, follow_ups,
  development_projects, production_projects, notifications, job_outbox,
  pitch_code_counters, password_reset_tokens, sessions, document_versions
TO pitch_app;

-- Append-only history tables: read + insert only.
GRANT SELECT, INSERT ON
  workflow_events, platform_responses, ratings, rating_scores, audit_logs,
  document_access_logs, document_scan_results, development_updates, production_updates,
  login_attempts, permissions
TO pitch_app;

-- Link tables where removing a row is a legitimate, audited business action.
GRANT SELECT, INSERT, DELETE ON user_roles, role_permissions, saved_filters, pitch_participants TO pitch_app;

-- Sessions and login attempts may be purged by retention jobs.
GRANT DELETE ON sessions, login_attempts, password_reset_tokens TO pitch_app;

;
-- ===== 0002_supabase_hardening =====
-- Hardening for managed PostgreSQL (Supabase) — also safe on plain PostgreSQL.
--
-- Why: Supabase's Data API (PostgREST/GraphQL) exposes the public schema to the roles
-- anon / authenticated / service_role, and its default privileges GRANT those roles full
-- access to every new table. This application never uses the Data API: the server connects
-- as `pitch_app` and enforces all authorization itself. So:
--   1. revoke every API role's access to our tables, sequences and functions (now and future)
--   2. enable Row Level Security on every table, with a policy that admits only `pitch_app`
--      (deny-by-default for any other non-owner role, even if a grant is added by mistake)
--   3. pin search_path on our trigger functions (prevents search_path hijacking)

CREATE OR REPLACE FUNCTION public.forbid_mutation() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  RAISE EXCEPTION 'IMMUTABLE_RECORD: % on % is not permitted', TG_OP, TG_TABLE_NAME
    USING ERRCODE = 'insufficient_privilege';
END;
$$;


CREATE OR REPLACE FUNCTION public.document_versions_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'IMMUTABLE_RECORD: DELETE on document_versions is not permitted'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF (to_jsonb(NEW) - 'scan_status') IS DISTINCT FROM (to_jsonb(OLD) - 'scan_status')
     OR OLD.scan_status <> 'PENDING' THEN
    RAISE EXCEPTION 'IMMUTABLE_RECORD: document_versions may only change scan_status from PENDING'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;


CREATE OR REPLACE FUNCTION public.workflow_config_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE def_id uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN def_id := OLD.definition_id; ELSE def_id := NEW.definition_id; END IF;
  IF EXISTS (SELECT 1 FROM public.pitches WHERE workflow_definition_id = def_id)
     OR (TG_OP = 'UPDATE' AND EXISTS (SELECT 1 FROM public.pitches WHERE workflow_definition_id = OLD.definition_id)) THEN
    RAISE EXCEPTION 'WORKFLOW_IN_USE: definition % is used by pitches; publish a new version', def_id
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;


CREATE OR REPLACE FUNCTION public.touch_updated_at() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;


REVOKE ALL ON FUNCTION public.forbid_mutation(), public.document_versions_guard(),
  public.workflow_config_guard(), public.touch_updated_at() FROM PUBLIC;


DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA public FROM %I', r);
      EXECUTE format('REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM %I', r);
      EXECUTE format('REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM %I', r);
      EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM %I', r);
      EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM %I', r);
      EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM %I', r);
    END IF;
  END LOOP;
END $$;


DO $$
DECLARE t text;
BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS app_server_only ON public.%I', t);
    -- The application server is the only intended client; it enforces per-user access itself.
    EXECUTE format('CREATE POLICY app_server_only ON public.%I AS PERMISSIVE FOR ALL TO pitch_app USING (true) WITH CHECK (true)', t);
  END LOOP;
END $$;


-- pg_trgm lives in "extensions" on Supabase; the app role needs it on its search path for similarity search.
ALTER ROLE pitch_app SET search_path = public, extensions;

;
-- ===== 0003_uploads =====
CREATE TYPE "public"."upload_kind" AS ENUM('DOCUMENT', 'IMAGE', 'CREATOR_PHOTO');
ALTER TYPE "public"."scan_status" ADD VALUE 'NOT_SCANNED';
CREATE TABLE "upload_intents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" "upload_kind" NOT NULL,
	"pitch_id" uuid,
	"document_id" uuid,
	"creator_id" uuid,
	"category_key" varchar(60),
	"title" varchar(200),
	"caption" varchar(300),
	"version_label" varchar(60),
	"notes" text,
	"original_filename" varchar(255) NOT NULL,
	"declared_size_bytes" bigint NOT NULL,
	"quarantine_key" text NOT NULL,
	"created_by_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone,
	"rejected_reason" varchar(200),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "upload_intents_target_ck" CHECK (("upload_intents"."kind" = 'CREATOR_PHOTO' AND "upload_intents"."creator_id" IS NOT NULL) OR ("upload_intents"."kind" <> 'CREATOR_PHOTO' AND "upload_intents"."pitch_id" IS NOT NULL))
);

ALTER TABLE "upload_intents" ADD CONSTRAINT "upload_intents_pitch_id_pitches_id_fk" FOREIGN KEY ("pitch_id") REFERENCES "public"."pitches"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "upload_intents" ADD CONSTRAINT "upload_intents_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "upload_intents" ADD CONSTRAINT "upload_intents_creator_id_creators_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."creators"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "upload_intents" ADD CONSTRAINT "upload_intents_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
CREATE UNIQUE INDEX "upload_intents_key_uq" ON "upload_intents" USING btree ("quarantine_key");
CREATE INDEX "upload_intents_user_idx" ON "upload_intents" USING btree ("created_by_id","created_at");
-- Every new table: least-privilege grant for the app role, RLS on, only the app-server policy, no API-role access.
GRANT SELECT, INSERT, UPDATE ON upload_intents TO pitch_app;

ALTER TABLE public.upload_intents ENABLE ROW LEVEL SECURITY;

CREATE POLICY app_server_only ON public.upload_intents AS PERMISSIVE FOR ALL TO pitch_app USING (true) WITH CHECK (true);

DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON public.upload_intents FROM %I', r);
    END IF;
  END LOOP;
END $$;

;
-- ===== 0004_storage_bucket =====
-- Private Supabase Storage bucket for scripts, documents and images (skipped on plain PostgreSQL).
-- public = false: objects are never reachable without a server-issued signed URL.
-- The size limit and MIME list are a second line of defence; the app validates actual file contents itself.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'storage')
     AND EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'storage' AND table_name = 'buckets') THEN
    INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    VALUES ('pitch-files', 'pitch-files', false, 52428800, ARRAY[
      'application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'text/plain',
      'application/vnd.ms-powerpoint', 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'image/jpeg', 'image/png', 'image/webp', 'application/octet-stream'])
    ON CONFLICT (id) DO UPDATE SET public = false, file_size_limit = EXCLUDED.file_size_limit, allowed_mime_types = EXCLUDED.allowed_mime_types;
  END IF;
END $$;

;
-- ===== 0005_extensions_usage =====
-- Supabase installs pg_trgm in the "extensions" schema. Search path alone is not enough:
-- the runtime role also needs USAGE on that schema, otherwise creator matching and search
-- (similarity(), the % operator) fail with "permission denied for schema extensions".
-- No-op on plain PostgreSQL, where the extension lives in public.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'extensions') THEN
    GRANT USAGE ON SCHEMA extensions TO pitch_app;
  END IF;
END $$;

;
CREATE SCHEMA IF NOT EXISTS drizzle;
CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at bigint);
REVOKE ALL ON SCHEMA drizzle FROM PUBLIC;
INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ('88cf22968493be70c7d60245417a3bd989c43f465aa4aa5cb74e42b55c45d2ba',1789463418886),('3e502e9f6ff1e1aec3b20bd29dcc2803680bfd58ee8c93fc1d5b9840b96ad240',1789463419874),('a62991e9d9783a1a70a76f7d13de96592d7e097ec36355949f5f1c256b044ea1',1789465214184),('b0d1fb9ef1fdf4d032bf9dba2f54eecbd1aefef6be38840f1df392e769569aee',1789465919780),('5cc45059269346a9607978685eaf46ac589c488d63a6e9e7c4c9d129fe8bcef7',1789468802552),('57cb8a9a4d1bb8b285c4a747c72587a500a17a1bbd525414f3a47c93e8f00c49',1789469659226);
-- ===== seed =====
INSERT INTO permissions (key,description) VALUES ('analytics.view','View dashboards and analytics'),('audit.view','View audit logs'),('config.manage','Manage lookups and settings'),('creator.archive','Archive creators'),('creator.create','Create creators'),('creator.edit','Edit creators'),('creator.view','View creator profiles'),('creator.view_pii','See creators'' full mobile and email'),('data.export','Export data'),('development.manage','Manage development tracker'),('document.download','Download confidential documents'),('document.upload','Upload documents, scripts and images'),('document.view_meta','See document lists and version history'),('pitch.accept','Accept / recommend pitches'),('pitch.approve_executive','CEO/COO approval, send back, greenlight'),('pitch.archive','Archive pitches'),('pitch.create','Create pitches'),('pitch.edit','Edit pitch information'),('pitch.forward','Assign or forward pitches'),('pitch.hold','Put pitches on hold and resume'),('pitch.reject','Reject pitches'),('pitch.reopen','Reopen rejected pitches'),('pitch.request_changes','Request changes'),('pitch.restore','Restore archived pitches'),('pitch.send_to_platform','Approve a pitch for platform pitching'),('pitch.view','View pitches the user is involved in'),('pitch.view_all','View all pitches up to the user''s clearance'),('platform.manage','Add, edit and disable platforms and contacts'),('platform.pitch','Record a pitch to a platform'),('platform.record_response','Record platform responses'),('platform.view','View platforms'),('production.manage','Manage production tracker'),('rating.add','Add ratings'),('rating.view','View ratings'),('report.view','View management reports'),('role.manage','Manage roles and permissions'),('user.manage','Manage users'),('workflow.manage','Configure workflow');
INSERT INTO roles (id,key,name,description,is_system) VALUES ('db9f851b-5350-4cf0-9e89-7a966c5541bd','ADMIN','Admin',NULL,'t'),('b0434caf-18f7-4651-9208-0102779bc8d8','CEO','CEO',NULL,'t'),('365cc4e9-923e-4a67-a063-023d30c37f0e','COO','COO',NULL,'t'),('12b56174-4896-4c2d-89ee-6d0b20322207','EMPLOYEE','Employee',NULL,'t'),('65428255-0237-429f-bc62-b8b7c4d7a458','SENIOR_EMPLOYEE','Senior Employee',NULL,'t'),('7a392511-fffc-4132-91d7-b1ecfb80db8a','SUPER_ADMIN','Super Admin',NULL,'t'),('f24740a9-8ccf-467d-8b74-74a966ac81d9','VIEWER','Viewer',NULL,'t');
INSERT INTO role_permissions (role_id,permission_key) SELECT r.id,v.p FROM (VALUES ('ADMIN','analytics.view'),('ADMIN','audit.view'),('ADMIN','config.manage'),('ADMIN','creator.archive'),('ADMIN','creator.create'),('ADMIN','creator.edit'),('ADMIN','creator.view'),('ADMIN','creator.view_pii'),('ADMIN','platform.manage'),('ADMIN','platform.view'),('ADMIN','report.view'),('ADMIN','role.manage'),('ADMIN','user.manage'),('ADMIN','workflow.manage'),('CEO','analytics.view'),('CEO','creator.create'),('CEO','creator.edit'),('CEO','creator.view'),('CEO','creator.view_pii'),('CEO','data.export'),('CEO','development.manage'),('CEO','document.download'),('CEO','document.upload'),('CEO','document.view_meta'),('CEO','pitch.accept'),('CEO','pitch.approve_executive'),('CEO','pitch.archive'),('CEO','pitch.create'),('CEO','pitch.edit'),('CEO','pitch.forward'),('CEO','pitch.hold'),('CEO','pitch.reject'),('CEO','pitch.reopen'),('CEO','pitch.request_changes'),('CEO','pitch.restore'),('CEO','pitch.send_to_platform'),('CEO','pitch.view'),('CEO','pitch.view_all'),('CEO','platform.pitch'),('CEO','platform.record_response'),('CEO','platform.view'),('CEO','production.manage'),('CEO','rating.add'),('CEO','rating.view'),('CEO','report.view'),('COO','analytics.view'),('COO','creator.create'),('COO','creator.edit'),('COO','creator.view'),('COO','creator.view_pii'),('COO','data.export'),('COO','development.manage'),('COO','document.download'),('COO','document.upload'),('COO','document.view_meta'),('COO','pitch.accept'),('COO','pitch.approve_executive'),('COO','pitch.archive'),('COO','pitch.create'),('COO','pitch.edit'),('COO','pitch.forward'),('COO','pitch.hold'),('COO','pitch.reject'),('COO','pitch.reopen'),('COO','pitch.request_changes'),('COO','pitch.restore'),('COO','pitch.send_to_platform'),('COO','pitch.view'),('COO','pitch.view_all'),('COO','platform.pitch'),('COO','platform.record_response'),('COO','platform.view'),('COO','production.manage'),('COO','rating.add'),('COO','rating.view'),('COO','report.view'),('EMPLOYEE','creator.create'),('EMPLOYEE','creator.view'),('EMPLOYEE','document.download'),('EMPLOYEE','document.upload'),('EMPLOYEE','document.view_meta'),('EMPLOYEE','pitch.accept'),('EMPLOYEE','pitch.create'),('EMPLOYEE','pitch.edit'),('EMPLOYEE','pitch.forward'),('EMPLOYEE','pitch.hold'),('EMPLOYEE','pitch.reject'),('EMPLOYEE','pitch.request_changes'),('EMPLOYEE','pitch.view'),('EMPLOYEE','platform.pitch'),('EMPLOYEE','platform.record_response'),('EMPLOYEE','platform.view'),('EMPLOYEE','rating.add'),('SENIOR_EMPLOYEE','analytics.view'),('SENIOR_EMPLOYEE','creator.create'),('SENIOR_EMPLOYEE','creator.edit'),('SENIOR_EMPLOYEE','creator.view'),('SENIOR_EMPLOYEE','creator.view_pii'),('SENIOR_EMPLOYEE','development.manage'),('SENIOR_EMPLOYEE','document.download'),('SENIOR_EMPLOYEE','document.upload'),('SENIOR_EMPLOYEE','document.view_meta'),('SENIOR_EMPLOYEE','pitch.accept'),('SENIOR_EMPLOYEE','pitch.create'),('SENIOR_EMPLOYEE','pitch.edit'),('SENIOR_EMPLOYEE','pitch.forward'),('SENIOR_EMPLOYEE','pitch.hold'),('SENIOR_EMPLOYEE','pitch.reject'),('SENIOR_EMPLOYEE','pitch.reopen'),('SENIOR_EMPLOYEE','pitch.request_changes'),('SENIOR_EMPLOYEE','pitch.view'),('SENIOR_EMPLOYEE','pitch.view_all'),('SENIOR_EMPLOYEE','platform.pitch'),('SENIOR_EMPLOYEE','platform.record_response'),('SENIOR_EMPLOYEE','platform.view'),('SENIOR_EMPLOYEE','production.manage'),('SENIOR_EMPLOYEE','rating.add'),('SENIOR_EMPLOYEE','rating.view'),('SENIOR_EMPLOYEE','report.view'),('SUPER_ADMIN','analytics.view'),('SUPER_ADMIN','audit.view'),('SUPER_ADMIN','config.manage'),('SUPER_ADMIN','creator.archive'),('SUPER_ADMIN','creator.create'),('SUPER_ADMIN','creator.edit'),('SUPER_ADMIN','creator.view'),('SUPER_ADMIN','creator.view_pii'),('SUPER_ADMIN','data.export'),('SUPER_ADMIN','development.manage'),('SUPER_ADMIN','document.download'),('SUPER_ADMIN','document.upload'),('SUPER_ADMIN','document.view_meta'),('SUPER_ADMIN','pitch.accept'),('SUPER_ADMIN','pitch.approve_executive'),('SUPER_ADMIN','pitch.archive'),('SUPER_ADMIN','pitch.create'),('SUPER_ADMIN','pitch.edit'),('SUPER_ADMIN','pitch.forward'),('SUPER_ADMIN','pitch.hold'),('SUPER_ADMIN','pitch.reject'),('SUPER_ADMIN','pitch.reopen'),('SUPER_ADMIN','pitch.request_changes'),('SUPER_ADMIN','pitch.restore'),('SUPER_ADMIN','pitch.send_to_platform'),('SUPER_ADMIN','pitch.view'),('SUPER_ADMIN','pitch.view_all'),('SUPER_ADMIN','platform.manage'),('SUPER_ADMIN','platform.pitch'),('SUPER_ADMIN','platform.record_response'),('SUPER_ADMIN','platform.view'),('SUPER_ADMIN','production.manage'),('SUPER_ADMIN','rating.add'),('SUPER_ADMIN','rating.view'),('SUPER_ADMIN','report.view'),('SUPER_ADMIN','role.manage'),('SUPER_ADMIN','user.manage'),('SUPER_ADMIN','workflow.manage'),('VIEWER','analytics.view'),('VIEWER','creator.view'),('VIEWER','pitch.view'),('VIEWER','platform.view'),('VIEWER','report.view')) v(k,p) JOIN roles r ON r.key=v.k;
INSERT INTO lookup_values (type,key,label,parent_key,sort_order,active) VALUES ('GENRE','DRAMA','Drama',NULL,0,'t'),('GENRE','THRILLER','Thriller',NULL,1,'t'),('GENRE','CRIME','Crime',NULL,2,'t'),('GENRE','COMEDY','Comedy',NULL,3,'t'),('GENRE','ROMANCE','Romance',NULL,4,'t'),('GENRE','ACTION','Action',NULL,5,'t'),('GENRE','HORROR','Horror',NULL,6,'t'),('GENRE','FAMILY','Family',NULL,7,'t'),('GENRE','MYTHOLOGY','Mythology',NULL,8,'t'),('GENRE','SCI_FI','Sci-Fi',NULL,9,'t'),('GENRE','FANTASY','Fantasy',NULL,10,'t'),('GENRE','DOCUMENTARY','Documentary',NULL,11,'t'),('GENRE','OTHER','Other',NULL,12,'t'),('LANGUAGE','TELUGU','Telugu',NULL,0,'t'),('LANGUAGE','HINDI','Hindi',NULL,1,'t'),('LANGUAGE','TAMIL','Tamil',NULL,2,'t'),('LANGUAGE','KANNADA','Kannada',NULL,3,'t'),('LANGUAGE','MALAYALAM','Malayalam',NULL,4,'t'),('LANGUAGE','ENGLISH','English',NULL,5,'t'),('LANGUAGE','OTHER','Other',NULL,6,'t'),('FORMAT','FEATURE_FILM','Feature Film',NULL,0,'t'),('FORMAT','WEB_SERIES','Web Series',NULL,1,'t'),('FORMAT','TV_SERIES','TV Series',NULL,2,'t'),('FORMAT','SHORT_FILM','Short Film',NULL,3,'t'),('FORMAT','DOCUMENTARY','Documentary',NULL,4,'t'),('FORMAT','REALITY','Reality',NULL,5,'t'),('FORMAT','OTHER','Other',NULL,6,'t'),('REJECTION_CATEGORY','WEAK_STORY','Weak Story',NULL,0,'t'),('REJECTION_CATEGORY','WEAK_SCREENPLAY','Weak Screenplay',NULL,1,'t'),('REJECTION_CATEGORY','POOR_EXECUTION','Poor Execution',NULL,2,'t'),('REJECTION_CATEGORY','NOT_COMMERCIALLY_VIABLE','Not Commercially Viable',NULL,3,'t'),('REJECTION_CATEGORY','NOT_SUITABLE_FOR_SLATE','Not Suitable for Current Slate',NULL,4,'t'),('REJECTION_CATEGORY','BUDGET_CONCERN','Budget Concern',NULL,5,'t'),('REJECTION_CATEGORY','CASTING_CONCERN','Casting Concern',NULL,6,'t'),('REJECTION_CATEGORY','PLATFORM_MISMATCH','Platform Mismatch',NULL,7,'t'),('REJECTION_CATEGORY','SIMILAR_EXISTING_CONTENT','Similar Existing Content',NULL,8,'t'),('REJECTION_CATEGORY','CREATOR_CONCERN','Creator Concern',NULL,9,'t'),('REJECTION_CATEGORY','NOT_SUITABLE_FOR_LANGUAGE','Not Suitable for Language',NULL,10,'t'),('REJECTION_CATEGORY','NOT_SUITABLE_FOR_GENRE','Not Suitable for Genre',NULL,11,'t'),('REJECTION_CATEGORY','OTHER','Other',NULL,12,'t'),('CHANGE_REQUEST_TYPE','SCRIPT','Script changes',NULL,0,'t'),('CHANGE_REQUEST_TYPE','SYNOPSIS','Synopsis changes',NULL,1,'t'),('CHANGE_REQUEST_TYPE','CHARACTER','Character changes',NULL,2,'t'),('CHANGE_REQUEST_TYPE','STRUCTURE','Structure changes',NULL,3,'t'),('CHANGE_REQUEST_TYPE','BUDGET','Budget changes',NULL,4,'t'),('CHANGE_REQUEST_TYPE','OTHER','Other',NULL,5,'t'),('DOCUMENT_CATEGORY','SCRIPT','Script',NULL,0,'t'),('DOCUMENT_CATEGORY','SYNOPSIS','Synopsis',NULL,1,'t'),('DOCUMENT_CATEGORY','ONE_LINE','One-line',NULL,2,'t'),('DOCUMENT_CATEGORY','CHARACTER_DOC','Character document',NULL,3,'t'),('DOCUMENT_CATEGORY','DIRECTORS_NOTE','Director''s note',NULL,4,'t'),('DOCUMENT_CATEGORY','PITCH_DECK','Pitch deck',NULL,5,'t'),('DOCUMENT_CATEGORY','PRESENTATION','Presentation',NULL,6,'t'),('DOCUMENT_CATEGORY','REFERENCE','Reference material',NULL,7,'t'),('DOCUMENT_CATEGORY','POSTER','Poster',NULL,8,'t'),('DOCUMENT_CATEGORY','OTHER','Other',NULL,9,'t'),('IMAGE_CATEGORY','STORY_REFERENCE','Story reference',NULL,0,'t'),('IMAGE_CATEGORY','CHARACTER_REFERENCE','Character reference',NULL,1,'t'),('IMAGE_CATEGORY','LOCATION_REFERENCE','Location reference',NULL,2,'t'),('IMAGE_CATEGORY','MOOD_BOARD','Mood board',NULL,3,'t'),('IMAGE_CATEGORY','POSTER','Poster',NULL,4,'t'),('IMAGE_CATEGORY','CONCEPT_ART','Concept art',NULL,5,'t'),('IMAGE_CATEGORY','PITCH_DECK_IMAGE','Pitch deck image',NULL,6,'t'),('IMAGE_CATEGORY','OTHER','Other',NULL,7,'t'),('BUDGET_RANGE','UNDER_1CR','Under ₹1 Cr',NULL,0,'t'),('BUDGET_RANGE','1_5CR','₹1–5 Cr',NULL,1,'t'),('BUDGET_RANGE','5_15CR','₹5–15 Cr',NULL,2,'t'),('BUDGET_RANGE','15_50CR','₹15–50 Cr',NULL,3,'t'),('BUDGET_RANGE','ABOVE_50CR','Above ₹50 Cr',NULL,4,'t'),('PITCH_METHOD','EMAIL','Email',NULL,0,'t'),('PITCH_METHOD','IN_PERSON','In-person meeting',NULL,1,'t'),('PITCH_METHOD','VIDEO_CALL','Video call',NULL,2,'t'),('PITCH_METHOD','PORTAL','Platform portal',NULL,3,'t'),('PITCH_METHOD','OTHER','Other',NULL,4,'t');
INSERT INTO rating_categories (key,label,sort_order,active) VALUES ('STORY_QUALITY','Story Quality',0,'t'),('SCREENPLAY_QUALITY','Screenplay Quality',1,'t'),('ORIGINALITY','Originality',2,'t'),('COMMERCIAL_POTENTIAL','Commercial Potential',3,'t'),('EXECUTION','Execution',4,'t'),('PROFESSIONALISM','Professionalism',5,'t');
INSERT INTO platforms (name,kind,language_keys,genre_keys,preferences,notes,active) VALUES ('Amazon MX Player','OTT','{}','{}',NULL,NULL,'t'),('Amazon Prime Video','OTT','{}','{}',NULL,NULL,'t'),('ETV Win','OTT','{}','{}',NULL,NULL,'t'),('JioHotstar','OTT','{}','{}',NULL,NULL,'t'),('Netflix','OTT','{}','{}',NULL,NULL,'t'),('Sony LIV','OTT','{}','{}',NULL,NULL,'t'),('Sun NXT','OTT','{}','{}',NULL,NULL,'t'),('YouTube','AVOD','{}','{}',NULL,NULL,'t'),('ZEE5','OTT','{}','{}',NULL,NULL,'t'),('aha','OTT','{}','{}',NULL,NULL,'t');
INSERT INTO system_settings (key,value) VALUES ('aging_thresholds_days','{"overdue": 7, "critical": 14, "attention": 3}'),('allow_self_approval','false'),('executive_approval_mode','"ANY"'),('ratings_visibility','"MANAGEMENT"');
INSERT INTO workflow_definitions (id,name,version,is_active,initial_stage_key) VALUES ('33d120a7-8fdd-44d1-9e98-ded3db2d0a40','Story Pipeline',1,'t','SUBMITTED');
INSERT INTO workflow_stages (definition_id,key,name,category,badge,is_terminal,requires_owner,sort_order) VALUES ('33d120a7-8fdd-44d1-9e98-ded3db2d0a40','SUBMITTED','Submitted','INTAKE','new','f','t',0),('33d120a7-8fdd-44d1-9e98-ded3db2d0a40','INITIAL_REVIEW','Initial Review','REVIEW','under_review','f','t',1),('33d120a7-8fdd-44d1-9e98-ded3db2d0a40','INTERNAL_REVIEW','Internal Review','REVIEW','under_review','f','t',2),('33d120a7-8fdd-44d1-9e98-ded3db2d0a40','SENIOR_REVIEW','Senior Review','REVIEW','under_review','f','t',3),('33d120a7-8fdd-44d1-9e98-ded3db2d0a40','EXECUTIVE_REVIEW','CEO / COO Review','EXECUTIVE','awaiting_approval','f','t',4),('33d120a7-8fdd-44d1-9e98-ded3db2d0a40','CHANGES_REQUESTED','Changes Requested','PAUSED','changes_requested','f','t',5),('33d120a7-8fdd-44d1-9e98-ded3db2d0a40','ON_HOLD','On Hold','PAUSED','on_hold','f','t',6),('33d120a7-8fdd-44d1-9e98-ded3db2d0a40','REJECTED','Rejected','TERMINAL','rejected','t','f',7),('33d120a7-8fdd-44d1-9e98-ded3db2d0a40','APPROVED_FOR_PLATFORM','Approved for Platform Pitching','PLATFORM','approved','f','t',8),('33d120a7-8fdd-44d1-9e98-ded3db2d0a40','PLATFORM_PITCHING','Platform Pitching','PLATFORM','platform','f','t',9),('33d120a7-8fdd-44d1-9e98-ded3db2d0a40','PLATFORM_APPROVED','Platform Approved','PLATFORM','platform_approved','f','t',10),('33d120a7-8fdd-44d1-9e98-ded3db2d0a40','READY_FOR_DEVELOPMENT','Ready for Development','DEVELOPMENT','ready_to_go','f','t',11),('33d120a7-8fdd-44d1-9e98-ded3db2d0a40','DEVELOPMENT','Development','DEVELOPMENT','development','f','t',12),('33d120a7-8fdd-44d1-9e98-ded3db2d0a40','GREENLIT','Greenlit','PRODUCTION','greenlit','f','t',13),('33d120a7-8fdd-44d1-9e98-ded3db2d0a40','PRE_PRODUCTION','Pre-Production','PRODUCTION','production','f','t',14),('33d120a7-8fdd-44d1-9e98-ded3db2d0a40','PRODUCTION','Production','PRODUCTION','production','f','t',15),('33d120a7-8fdd-44d1-9e98-ded3db2d0a40','POST_PRODUCTION','Post-Production','PRODUCTION','production','f','t',16),('33d120a7-8fdd-44d1-9e98-ded3db2d0a40','COMPLETED','Completed','PRODUCTION','completed','f','t',17),('33d120a7-8fdd-44d1-9e98-ded3db2d0a40','RELEASED','Released','TERMINAL','released','t','t',18);
INSERT INTO workflow_transitions (definition_id,from_stage_key,to_stage_key,action,required_permission,allowed_role_keys,requires_current_owner,requires_remarks,requires_rejection_reason,requires_recipient,recipient_role_keys,requires_change_types,requires_platform,is_approval) VALUES ('33d120a7-8fdd-44d1-9e98-ded3db2d0a40','APPROVED_FOR_PLATFORM','APPROVED_FOR_PLATFORM','ASSIGN','pitch.forward','{SENIOR_EMPLOYEE,CEO,COO,SUPER_ADMIN}','f','t','f','t',NULL,'f','f','f'),('33d120a7-8fdd-44d1-9e98-ded3db2d0a40','APPROVED_FOR_PLATFORM','PLATFORM_PITCHING','RECORD_PLATFORM_PITCH','platform.pitch',NULL,'t','f','f','f',NULL,'f','t','f'),('33d120a7-8fdd-44d1-9e98-ded3db2d0a40','CHANGES_REQUESTED','CHANGES_REQUESTED','ASSIGN','pitch.forward','{SENIOR_EMPLOYEE,CEO,COO,SUPER_ADMIN}','f','t','f','t',NULL,'f','f','f'),('33d120a7-8fdd-44d1-9e98-ded3db2d0a40','CHANGES_REQUESTED',NULL,'RESUME','pitch.request_changes',NULL,'t','t','f','f',NULL,'f','f','f'),('33d120a7-8fdd-44d1-9e98-ded3db2d0a40','COMPLETED','COMPLETED','ASSIGN','pitch.forward','{SENIOR_EMPLOYEE,CEO,COO,SUPER_ADMIN}','f','t','f','t',NULL,'f','f','f'),('33d120a7-8fdd-44d1-9e98-ded3db2d0a40','COMPLETED','RELEASED','ADVANCE','production.manage',NULL,'f','f','f','f',NULL,'f','f','f'),('33d120a7-8fdd-44d1-9e98-ded3db2d0a40','DEVELOPMENT','DEVELOPMENT','ASSIGN','pitch.forward','{SENIOR_EMPLOYEE,CEO,COO,SUPER_ADMIN}','f','t','f','t',NULL,'f','f','f'),('33d120a7-8fdd-44d1-9e98-ded3db2d0a40','DEVELOPMENT','GREENLIT','GREENLIGHT','pitch.approve_executive','{CEO,COO,SUPER_ADMIN}','f','t','f','t',NULL,'f','f','t'),('33d120a7-8fdd-44d1-9e98-ded3db2d0a40','EXECUTIVE_REVIEW','EXECUTIVE_REVIEW','ASSIGN','pitch.forward','{CEO,COO,SUPER_ADMIN}','f','t','f','t','{CEO,COO}','f','f','f'),('33d120a7-8fdd-44d1-9e98-ded3db2d0a40','EXECUTIVE_REVIEW','REJECTED','REJECT','pitch.reject','{CEO,COO,SUPER_ADMIN}','f','f','t','f',NULL,'f','f','f'),('33d120a7-8fdd-44d1-9e98-ded3db2d0a40','EXECUTIVE_REVIEW','CHANGES_REQUESTED','REQUEST_CHANGES','pitch.request_changes','{CEO,COO,SUPER_ADMIN}','f','t','f','f',NULL,'t','f','f'),('33d120a7-8fdd-44d1-9e98-ded3db2d0a40','EXECUTIVE_REVIEW','ON_HOLD','HOLD','pitch.hold','{CEO,COO,SUPER_ADMIN}','f','t','f','f',NULL,'f','f','f'),('33d120a7-8fdd-44d1-9e98-ded3db2d0a40','EXECUTIVE_REVIEW','APPROVED_FOR_PLATFORM','APPROVE','pitch.approve_executive','{CEO,COO,SUPER_ADMIN}','f','t','f','t',NULL,'f','f','t'),('33d120a7-8fdd-44d1-9e98-ded3db2d0a40','EXECUTIVE_REVIEW','APPROVED_FOR_PLATFORM','SEND_TO_PLATFORM','pitch.send_to_platform','{CEO,COO,SUPER_ADMIN}','f','t','f','t',NULL,'f','f','t'),('33d120a7-8fdd-44d1-9e98-ded3db2d0a40','EXECUTIVE_REVIEW','SENIOR_REVIEW','SEND_BACK','pitch.approve_executive','{CEO,COO,SUPER_ADMIN}','f','t','f','t','{SENIOR_EMPLOYEE,CEO,COO,SUPER_ADMIN}','f','f','f'),('33d120a7-8fdd-44d1-9e98-ded3db2d0a40','GREENLIT','GREENLIT','ASSIGN','pitch.forward','{SENIOR_EMPLOYEE,CEO,COO,SUPER_ADMIN}','f','t','f','t',NULL,'f','f','f'),('33d120a7-8fdd-44d1-9e98-ded3db2d0a40','GREENLIT','PRE_PRODUCTION','ADVANCE','production.manage',NULL,'f','f','f','f',NULL,'f','f','f'),('33d120a7-8fdd-44d1-9e98-ded3db2d0a40','INITIAL_REVIEW','INITIAL_REVIEW','ASSIGN','pitch.forward','{SENIOR_EMPLOYEE,CEO,COO,SUPER_ADMIN}','f','t','f','t',NULL,'f','f','f'),('33d120a7-8fdd-44d1-9e98-ded3db2d0a40','INITIAL_REVIEW','EXECUTIVE_REVIEW','FORWARD','pitch.forward',NULL,'t','t','f','t','{CEO,COO}','f','f','f'),('33d120a7-8fdd-44d1-9e98-ded3db2d0a40','INITIAL_REVIEW','INITIAL_REVIEW','FORWARD','pitch.forward',NULL,'t','t','f','t','{EMPLOYEE,SENIOR_EMPLOYEE,CEO,COO,SUPER_ADMIN}','f','f','f'),('33d120a7-8fdd-44d1-9e98-ded3db2d0a40','INITIAL_REVIEW','INTERNAL_REVIEW','FORWARD','pitch.forward',NULL,'t','t','f','t','{EMPLOYEE,SENIOR_EMPLOYEE,CEO,COO,SUPER_ADMIN}','f','f','f'),('33d120a7-8fdd-44d1-9e98-ded3db2d0a40','INITIAL_REVIEW','SENIOR_REVIEW','FORWARD','pitch.forward',NULL,'t','t','f','t','{SENIOR_EMPLOYEE,CEO,COO,SUPER_ADMIN}','f','f','f'),('33d120a7-8fdd-44d1-9e98-ded3db2d0a40','INITIAL_REVIEW','INTERNAL_REVIEW','ACCEPT','pitch.accept',NULL,'t','t','f','t','{EMPLOYEE,SENIOR_EMPLOYEE,CEO,COO,SUPER_ADMIN}','f','f','f'),('33d120a7-8fdd-44d1-9e98-ded3db2d0a40','INITIAL_REVIEW','REJECTED','REJECT','pitch.reject',NULL,'t','f','t','f',NULL,'f','f','f'),('33d120a7-8fdd-44d1-9e98-ded3db2d0a40','INITIAL_REVIEW','CHANGES_REQUESTED','REQUEST_CHANGES','pitch.request_changes',NULL,'t','t','f','f',NULL,'t','f','f'),('33d120a7-8fdd-44d1-9e98-ded3db2d0a40','INITIAL_REVIEW','ON_HOLD','HOLD','pitch.hold',NULL,'t','t','f','f',NULL,'f','f','f'),('33d120a7-8fdd-44d1-9e98-ded3db2d0a40','INTERNAL_REVIEW','INTERNAL_REVIEW','ASSIGN','pitch.forward','{SENIOR_EMPLOYEE,CEO,COO,SUPER_ADMIN}','f','t','f','t',NULL,'f','f','f'),('33d120a7-8fdd-44d1-9e98-ded3db2d0a40','INTERNAL_REVIEW','EXECUTIVE_REVIEW','FORWARD','pitch.forward',NULL,'t','t','f','t','{CEO,COO}','f','f','f'),('33d120a7-8fdd-44d1-9e98-ded3db2d0a40','INTERNAL_REVIEW','INTERNAL_REVIEW','FORWARD','pitch.forward',NULL,'t','t','f','t','{EMPLOYEE,SENIOR_EMPLOYEE,CEO,COO,SUPER_ADMIN}','f','f','f'),('33d120a7-8fdd-44d1-9e98-ded3db2d0a40','INTERNAL_REVIEW','SENIOR_REVIEW','FORWARD','pitch.forward',NULL,'t','t','f','t','{SENIOR_EMPLOYEE,CEO,COO,SUPER_ADMIN}','f','f','f'),('33d120a7-8fdd-44d1-9e98-ded3db2d0a40','INTERNAL_REVIEW','SENIOR_REVIEW','ACCEPT','pitch.accept',NULL,'t','t','f','t','{SENIOR_EMPLOYEE,CEO,COO,SUPER_ADMIN}','f','f','f'),('33d120a7-8fdd-44d1-9e98-ded3db2d0a40','INTERNAL_REVIEW','REJECTED','REJECT','pitch.reject',NULL,'t','f','t','f',NULL,'f','f','f'),('33d120a7-8fdd-44d1-9e98-ded3db2d0a40','INTERNAL_REVIEW','CHANGES_REQUESTED','REQUEST_CHANGES','pitch.request_changes',NULL,'t','t','f','f',NULL,'t','f','f'),('33d120a7-8fdd-44d1-9e98-ded3db2d0a40','INTERNAL_REVIEW','ON_HOLD','HOLD','pitch.hold',NULL,'t','t','f','f',NULL,'f','f','f'),('33d120a7-8fdd-44d1-9e98-ded3db2d0a40','ON_HOLD','ON_HOLD','ASSIGN','pitch.forward','{SENIOR_EMPLOYEE,CEO,COO,SUPER_ADMIN}','f','t','f','t',NULL,'f','f','f'),('33d120a7-8fdd-44d1-9e98-ded3db2d0a40','ON_HOLD',NULL,'RESUME','pitch.hold',NULL,'t','t','f','f',NULL,'f','f','f'),('33d120a7-8fdd-44d1-9e98-ded3db2d0a40','PLATFORM_APPROVED','PLATFORM_APPROVED','ASSIGN','pitch.forward','{SENIOR_EMPLOYEE,CEO,COO,SUPER_ADMIN}','f','t','f','t',NULL,'f','f','f'),('33d120a7-8fdd-44d1-9e98-ded3db2d0a40','PLATFORM_APPROVED','READY_FOR_DEVELOPMENT','MARK_READY_FOR_DEVELOPMENT','development.manage','{SENIOR_EMPLOYEE,CEO,COO,SUPER_ADMIN}','f','f','f','f',NULL,'f','f','f'),('33d120a7-8fdd-44d1-9e98-ded3db2d0a40','PLATFORM_PITCHING','PLATFORM_PITCHING','ASSIGN','pitch.forward','{SENIOR_EMPLOYEE,CEO,COO,SUPER_ADMIN}','f','t','f','t',NULL,'f','f','f'),('33d120a7-8fdd-44d1-9e98-ded3db2d0a40','PLATFORM_PITCHING','REJECTED','REJECT','pitch.reject','{CEO,COO,SUPER_ADMIN}','f','f','t','f',NULL,'f','f','f'),('33d120a7-8fdd-44d1-9e98-ded3db2d0a40','PLATFORM_PITCHING','ON_HOLD','HOLD','pitch.hold',NULL,'t','t','f','f',NULL,'f','f','f'),('33d120a7-8fdd-44d1-9e98-ded3db2d0a40','PLATFORM_PITCHING','PLATFORM_PITCHING','RECORD_PLATFORM_PITCH','platform.pitch',NULL,'t','f','f','f',NULL,'f','t','f'),('33d120a7-8fdd-44d1-9e98-ded3db2d0a40','PLATFORM_PITCHING','PLATFORM_APPROVED','MARK_PLATFORM_APPROVED','platform.record_response',NULL,'t','t','f','f',NULL,'f','t','f'),('33d120a7-8fdd-44d1-9e98-ded3db2d0a40','POST_PRODUCTION','POST_PRODUCTION','ASSIGN','pitch.forward','{SENIOR_EMPLOYEE,CEO,COO,SUPER_ADMIN}','f','t','f','t',NULL,'f','f','f'),('33d120a7-8fdd-44d1-9e98-ded3db2d0a40','POST_PRODUCTION','COMPLETED','ADVANCE','production.manage',NULL,'f','f','f','f',NULL,'f','f','f'),('33d120a7-8fdd-44d1-9e98-ded3db2d0a40','PRE_PRODUCTION','PRE_PRODUCTION','ASSIGN','pitch.forward','{SENIOR_EMPLOYEE,CEO,COO,SUPER_ADMIN}','f','t','f','t',NULL,'f','f','f'),('33d120a7-8fdd-44d1-9e98-ded3db2d0a40','PRE_PRODUCTION','PRODUCTION','ADVANCE','production.manage',NULL,'f','f','f','f',NULL,'f','f','f'),('33d120a7-8fdd-44d1-9e98-ded3db2d0a40','PRODUCTION','PRODUCTION','ASSIGN','pitch.forward','{SENIOR_EMPLOYEE,CEO,COO,SUPER_ADMIN}','f','t','f','t',NULL,'f','f','f'),('33d120a7-8fdd-44d1-9e98-ded3db2d0a40','PRODUCTION','POST_PRODUCTION','ADVANCE','production.manage',NULL,'f','f','f','f',NULL,'f','f','f'),('33d120a7-8fdd-44d1-9e98-ded3db2d0a40','READY_FOR_DEVELOPMENT','READY_FOR_DEVELOPMENT','ASSIGN','pitch.forward','{SENIOR_EMPLOYEE,CEO,COO,SUPER_ADMIN}','f','t','f','t',NULL,'f','f','f'),('33d120a7-8fdd-44d1-9e98-ded3db2d0a40','READY_FOR_DEVELOPMENT','DEVELOPMENT','START_DEVELOPMENT','development.manage',NULL,'f','f','f','t',NULL,'f','f','f'),('33d120a7-8fdd-44d1-9e98-ded3db2d0a40','REJECTED','SENIOR_REVIEW','REOPEN','pitch.reopen',NULL,'f','t','f','t','{SENIOR_EMPLOYEE,CEO,COO,SUPER_ADMIN}','f','f','f'),('33d120a7-8fdd-44d1-9e98-ded3db2d0a40','SENIOR_REVIEW','SENIOR_REVIEW','ASSIGN','pitch.forward','{SENIOR_EMPLOYEE,CEO,COO,SUPER_ADMIN}','f','t','f','t',NULL,'f','f','f'),('33d120a7-8fdd-44d1-9e98-ded3db2d0a40','SENIOR_REVIEW','EXECUTIVE_REVIEW','FORWARD','pitch.forward',NULL,'t','t','f','t','{CEO,COO}','f','f','f'),('33d120a7-8fdd-44d1-9e98-ded3db2d0a40','SENIOR_REVIEW','SENIOR_REVIEW','FORWARD','pitch.forward',NULL,'t','t','f','t','{SENIOR_EMPLOYEE,CEO,COO,SUPER_ADMIN}','f','f','f'),('33d120a7-8fdd-44d1-9e98-ded3db2d0a40','SENIOR_REVIEW','EXECUTIVE_REVIEW','ACCEPT','pitch.accept',NULL,'t','t','f','t','{CEO,COO}','f','f','f'),('33d120a7-8fdd-44d1-9e98-ded3db2d0a40','SENIOR_REVIEW','REJECTED','REJECT','pitch.reject',NULL,'t','f','t','f',NULL,'f','f','f'),('33d120a7-8fdd-44d1-9e98-ded3db2d0a40','SENIOR_REVIEW','CHANGES_REQUESTED','REQUEST_CHANGES','pitch.request_changes',NULL,'t','t','f','f',NULL,'t','f','f'),('33d120a7-8fdd-44d1-9e98-ded3db2d0a40','SENIOR_REVIEW','ON_HOLD','HOLD','pitch.hold',NULL,'t','t','f','f',NULL,'f','f','f'),('33d120a7-8fdd-44d1-9e98-ded3db2d0a40','SUBMITTED','INITIAL_REVIEW','ASSIGN','pitch.forward',NULL,'f','f','f','t','{EMPLOYEE,SENIOR_EMPLOYEE,CEO,COO,SUPER_ADMIN}','f','f','f');

COMMIT;