CREATE EXTENSION IF NOT EXISTS pgcrypto;--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint
CREATE TYPE "public"."document_access_action" AS ENUM('VIEW', 'DOWNLOAD');--> statement-breakpoint
CREATE TYPE "public"."confidentiality_level" AS ENUM('STANDARD', 'CONFIDENTIAL', 'RESTRICTED');--> statement-breakpoint
CREATE TYPE "public"."creator_type" AS ENUM('WRITER', 'DIRECTOR', 'WRITER_DIRECTOR', 'PRODUCER', 'CREATOR', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."development_status" AS ENUM('READY_FOR_DEVELOPMENT', 'DEVELOPMENT_STARTED', 'SCRIPT_DEVELOPMENT', 'CASTING_DEVELOPMENT', 'PACKAGING', 'AWAITING_APPROVAL', 'DEVELOPMENT_COMPLETED');--> statement-breakpoint
CREATE TYPE "public"."job_status" AS ENUM('PENDING', 'RUNNING', 'DONE', 'FAILED');--> statement-breakpoint
CREATE TYPE "public"."lookup_type" AS ENUM('GENRE', 'SUB_GENRE', 'LANGUAGE', 'FORMAT', 'REJECTION_CATEGORY', 'CHANGE_REQUEST_TYPE', 'DOCUMENT_CATEGORY', 'IMAGE_CATEGORY', 'BUDGET_RANGE', 'TARGET_AUDIENCE', 'PITCH_METHOD');--> statement-breakpoint
CREATE TYPE "public"."participant_reason" AS ENUM('CREATED', 'ASSIGNED', 'REVIEWED', 'PLATFORM_OWNER', 'DEVELOPMENT_OWNER', 'PRODUCTION_OWNER', 'GRANTED');--> statement-breakpoint
CREATE TYPE "public"."platform_status" AS ENUM('NOT_YET_PITCHED', 'PITCHED', 'AWAITING_RESPONSE', 'INTERESTED', 'MEETING_REQUESTED', 'REQUESTED_CHANGES', 'SECOND_DRAFT_REQUESTED', 'APPROVED', 'REJECTED', 'ON_HOLD', 'DEVELOPMENT_DISCUSSION', 'READY_FOR_DEVELOPMENT', 'GREENLIT');--> statement-breakpoint
CREATE TYPE "public"."priority" AS ENUM('LOW', 'MEDIUM', 'HIGH', 'URGENT');--> statement-breakpoint
CREATE TYPE "public"."production_status" AS ENUM('GREENLIT', 'PRE_PRODUCTION', 'PRODUCTION', 'POST_PRODUCTION', 'COMPLETED', 'RELEASED');--> statement-breakpoint
CREATE TYPE "public"."scan_status" AS ENUM('PENDING', 'CLEAN', 'INFECTED', 'FAILED');--> statement-breakpoint
CREATE TYPE "public"."stage_category" AS ENUM('INTAKE', 'REVIEW', 'EXECUTIVE', 'PLATFORM', 'DEVELOPMENT', 'PRODUCTION', 'PAUSED', 'TERMINAL');--> statement-breakpoint
CREATE TYPE "public"."user_status" AS ENUM('ACTIVE', 'DISABLED', 'PENDING_VERIFICATION');--> statement-breakpoint
CREATE TYPE "public"."workflow_action" AS ENUM('SUBMIT', 'ASSIGN', 'FORWARD', 'ACCEPT', 'REJECT', 'REQUEST_CHANGES', 'HOLD', 'RESUME', 'APPROVE', 'SEND_TO_PLATFORM', 'SEND_BACK', 'RECORD_PLATFORM_PITCH', 'MARK_PLATFORM_APPROVED', 'MARK_READY_FOR_DEVELOPMENT', 'START_DEVELOPMENT', 'GREENLIGHT', 'ADVANCE', 'REOPEN');--> statement-breakpoint
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
--> statement-breakpoint
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
--> statement-breakpoint
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
--> statement-breakpoint
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
--> statement-breakpoint
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
--> statement-breakpoint
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
--> statement-breakpoint
CREATE TABLE "document_scan_results" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_version_id" uuid NOT NULL,
	"status" "scan_status" NOT NULL,
	"engine" varchar(60),
	"detail" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
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
--> statement-breakpoint
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
--> statement-breakpoint
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
--> statement-breakpoint
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
--> statement-breakpoint
CREATE TABLE "login_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email_hash" "bytea" NOT NULL,
	"ip" "inet",
	"success" boolean NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
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
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"type" varchar(60) NOT NULL,
	"title" varchar(200) NOT NULL,
	"pitch_id" uuid,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "password_reset_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" "bytea" NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "permissions" (
	"key" varchar(60) PRIMARY KEY NOT NULL,
	"description" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pitch_code_counters" (
	"year" smallint PRIMARY KEY NOT NULL,
	"last_value" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
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
--> statement-breakpoint
CREATE TABLE "pitch_participants" (
	"pitch_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"reason" "participant_reason" NOT NULL,
	"granted_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pitch_participants_pitch_id_user_id_reason_pk" PRIMARY KEY("pitch_id","user_id","reason")
);
--> statement-breakpoint
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
--> statement-breakpoint
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
--> statement-breakpoint
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
--> statement-breakpoint
CREATE TABLE "platform_responses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"platform_pitch_id" uuid NOT NULL,
	"status" "platform_status" NOT NULL,
	"response_date" date NOT NULL,
	"notes" text,
	"recorded_by_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
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
--> statement-breakpoint
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
--> statement-breakpoint
CREATE TABLE "production_updates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"production_project_id" uuid NOT NULL,
	"status" "production_status" NOT NULL,
	"body" text,
	"author_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rating_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" varchar(60) NOT NULL,
	"label" varchar(120) NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rating_scores" (
	"rating_id" uuid NOT NULL,
	"category_id" uuid NOT NULL,
	"score" smallint NOT NULL,
	CONSTRAINT "rating_scores_rating_id_category_id_pk" PRIMARY KEY("rating_id","category_id"),
	CONSTRAINT "rating_scores_score_ck" CHECK ("rating_scores"."score" BETWEEN 1 AND 5)
);
--> statement-breakpoint
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
--> statement-breakpoint
CREATE TABLE "role_permissions" (
	"role_id" uuid NOT NULL,
	"permission_key" varchar(60) NOT NULL,
	CONSTRAINT "role_permissions_role_id_permission_key_pk" PRIMARY KEY("role_id","permission_key")
);
--> statement-breakpoint
CREATE TABLE "roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" varchar(50) NOT NULL,
	"name" varchar(80) NOT NULL,
	"description" text,
	"is_system" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "saved_filters" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" varchar(120) NOT NULL,
	"scope" varchar(40) DEFAULT 'PITCHES' NOT NULL,
	"query" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
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
--> statement-breakpoint
CREATE TABLE "system_settings" (
	"key" varchar(80) PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_by_id" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_roles" (
	"user_id" uuid NOT NULL,
	"role_id" uuid NOT NULL,
	"granted_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_roles_user_id_role_id_pk" PRIMARY KEY("user_id","role_id")
);
--> statement-breakpoint
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
--> statement-breakpoint
CREATE TABLE "workflow_definitions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(120) NOT NULL,
	"version" integer NOT NULL,
	"is_active" boolean DEFAULT false NOT NULL,
	"initial_stage_key" varchar(60) NOT NULL,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
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
--> statement-breakpoint
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
--> statement-breakpoint
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
--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "creator_projects" ADD CONSTRAINT "creator_projects_creator_id_creators_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."creators"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "creator_projects" ADD CONSTRAINT "creator_projects_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "creators" ADD CONSTRAINT "creators_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "development_projects" ADD CONSTRAINT "development_projects_pitch_id_pitches_id_fk" FOREIGN KEY ("pitch_id") REFERENCES "public"."pitches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "development_projects" ADD CONSTRAINT "development_projects_platform_pitch_id_platform_pitches_id_fk" FOREIGN KEY ("platform_pitch_id") REFERENCES "public"."platform_pitches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "development_projects" ADD CONSTRAINT "development_projects_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "development_updates" ADD CONSTRAINT "development_updates_development_project_id_development_projects_id_fk" FOREIGN KEY ("development_project_id") REFERENCES "public"."development_projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "development_updates" ADD CONSTRAINT "development_updates_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_access_logs" ADD CONSTRAINT "document_access_logs_document_version_id_document_versions_id_fk" FOREIGN KEY ("document_version_id") REFERENCES "public"."document_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_access_logs" ADD CONSTRAINT "document_access_logs_pitch_id_pitches_id_fk" FOREIGN KEY ("pitch_id") REFERENCES "public"."pitches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_access_logs" ADD CONSTRAINT "document_access_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_scan_results" ADD CONSTRAINT "document_scan_results_document_version_id_document_versions_id_fk" FOREIGN KEY ("document_version_id") REFERENCES "public"."document_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_versions" ADD CONSTRAINT "document_versions_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_versions" ADD CONSTRAINT "document_versions_uploaded_by_id_users_id_fk" FOREIGN KEY ("uploaded_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_pitch_id_pitches_id_fk" FOREIGN KEY ("pitch_id") REFERENCES "public"."pitches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "follow_ups" ADD CONSTRAINT "follow_ups_platform_pitch_id_platform_pitches_id_fk" FOREIGN KEY ("platform_pitch_id") REFERENCES "public"."platform_pitches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "follow_ups" ADD CONSTRAINT "follow_ups_assignee_id_users_id_fk" FOREIGN KEY ("assignee_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "follow_ups" ADD CONSTRAINT "follow_ups_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_pitch_id_pitches_id_fk" FOREIGN KEY ("pitch_id") REFERENCES "public"."pitches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pitch_images" ADD CONSTRAINT "pitch_images_pitch_id_pitches_id_fk" FOREIGN KEY ("pitch_id") REFERENCES "public"."pitches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pitch_images" ADD CONSTRAINT "pitch_images_uploaded_by_id_users_id_fk" FOREIGN KEY ("uploaded_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pitch_participants" ADD CONSTRAINT "pitch_participants_pitch_id_pitches_id_fk" FOREIGN KEY ("pitch_id") REFERENCES "public"."pitches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pitch_participants" ADD CONSTRAINT "pitch_participants_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pitch_participants" ADD CONSTRAINT "pitch_participants_granted_by_id_users_id_fk" FOREIGN KEY ("granted_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pitches" ADD CONSTRAINT "pitches_creator_id_creators_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."creators"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pitches" ADD CONSTRAINT "pitches_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pitches" ADD CONSTRAINT "pitches_workflow_definition_id_workflow_definitions_id_fk" FOREIGN KEY ("workflow_definition_id") REFERENCES "public"."workflow_definitions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pitches" ADD CONSTRAINT "pitches_current_owner_id_users_id_fk" FOREIGN KEY ("current_owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pitches" ADD CONSTRAINT "pitches_archived_by_id_users_id_fk" FOREIGN KEY ("archived_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_contacts" ADD CONSTRAINT "platform_contacts_platform_id_platforms_id_fk" FOREIGN KEY ("platform_id") REFERENCES "public"."platforms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_pitches" ADD CONSTRAINT "platform_pitches_pitch_id_pitches_id_fk" FOREIGN KEY ("pitch_id") REFERENCES "public"."pitches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_pitches" ADD CONSTRAINT "platform_pitches_platform_id_platforms_id_fk" FOREIGN KEY ("platform_id") REFERENCES "public"."platforms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_pitches" ADD CONSTRAINT "platform_pitches_pitched_by_id_users_id_fk" FOREIGN KEY ("pitched_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_pitches" ADD CONSTRAINT "platform_pitches_contact_id_platform_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."platform_contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_pitches" ADD CONSTRAINT "platform_pitches_script_version_id_document_versions_id_fk" FOREIGN KEY ("script_version_id") REFERENCES "public"."document_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_pitches" ADD CONSTRAINT "platform_pitches_deck_version_id_document_versions_id_fk" FOREIGN KEY ("deck_version_id") REFERENCES "public"."document_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_responses" ADD CONSTRAINT "platform_responses_platform_pitch_id_platform_pitches_id_fk" FOREIGN KEY ("platform_pitch_id") REFERENCES "public"."platform_pitches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_responses" ADD CONSTRAINT "platform_responses_recorded_by_id_users_id_fk" FOREIGN KEY ("recorded_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_projects" ADD CONSTRAINT "production_projects_pitch_id_pitches_id_fk" FOREIGN KEY ("pitch_id") REFERENCES "public"."pitches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_projects" ADD CONSTRAINT "production_projects_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_projects" ADD CONSTRAINT "production_projects_platform_id_platforms_id_fk" FOREIGN KEY ("platform_id") REFERENCES "public"."platforms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_updates" ADD CONSTRAINT "production_updates_production_project_id_production_projects_id_fk" FOREIGN KEY ("production_project_id") REFERENCES "public"."production_projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_updates" ADD CONSTRAINT "production_updates_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rating_scores" ADD CONSTRAINT "rating_scores_rating_id_ratings_id_fk" FOREIGN KEY ("rating_id") REFERENCES "public"."ratings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rating_scores" ADD CONSTRAINT "rating_scores_category_id_rating_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."rating_categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ratings" ADD CONSTRAINT "ratings_creator_id_creators_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."creators"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ratings" ADD CONSTRAINT "ratings_pitch_id_pitches_id_fk" FOREIGN KEY ("pitch_id") REFERENCES "public"."pitches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ratings" ADD CONSTRAINT "ratings_reviewer_id_users_id_fk" FOREIGN KEY ("reviewer_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ratings" ADD CONSTRAINT "ratings_workflow_event_id_workflow_events_id_fk" FOREIGN KEY ("workflow_event_id") REFERENCES "public"."workflow_events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permission_key_permissions_key_fk" FOREIGN KEY ("permission_key") REFERENCES "public"."permissions"("key") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_filters" ADD CONSTRAINT "saved_filters_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "system_settings" ADD CONSTRAINT "system_settings_updated_by_id_users_id_fk" FOREIGN KEY ("updated_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_granted_by_id_users_id_fk" FOREIGN KEY ("granted_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_definitions" ADD CONSTRAINT "workflow_definitions_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_events" ADD CONSTRAINT "workflow_events_pitch_id_pitches_id_fk" FOREIGN KEY ("pitch_id") REFERENCES "public"."pitches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_events" ADD CONSTRAINT "workflow_events_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_events" ADD CONSTRAINT "workflow_events_from_owner_id_users_id_fk" FOREIGN KEY ("from_owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_events" ADD CONSTRAINT "workflow_events_to_owner_id_users_id_fk" FOREIGN KEY ("to_owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_events" ADD CONSTRAINT "workflow_events_platform_id_platforms_id_fk" FOREIGN KEY ("platform_id") REFERENCES "public"."platforms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_stages" ADD CONSTRAINT "workflow_stages_definition_id_workflow_definitions_id_fk" FOREIGN KEY ("definition_id") REFERENCES "public"."workflow_definitions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_transitions" ADD CONSTRAINT "workflow_transitions_definition_id_workflow_definitions_id_fk" FOREIGN KEY ("definition_id") REFERENCES "public"."workflow_definitions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_transitions" ADD CONSTRAINT "workflow_transitions_required_permission_permissions_key_fk" FOREIGN KEY ("required_permission") REFERENCES "public"."permissions"("key") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_logs_resource_idx" ON "audit_logs" USING btree ("resource_type","resource_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_logs_actor_idx" ON "audit_logs" USING btree ("actor_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_logs_action_idx" ON "audit_logs" USING btree ("action","created_at");--> statement-breakpoint
CREATE INDEX "creator_projects_creator_idx" ON "creator_projects" USING btree ("creator_id");--> statement-breakpoint
CREATE UNIQUE INDEX "creators_mobile_uq" ON "creators" USING btree ("mobile_e164") WHERE "creators"."mobile_e164" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "creators_email_uq" ON "creators" USING btree ("email_normalized") WHERE "creators"."email_normalized" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "creators_name_trgm_idx" ON "creators" USING gin ("name_normalized" gin_trgm_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "development_projects_pitch_uq" ON "development_projects" USING btree ("pitch_id");--> statement-breakpoint
CREATE INDEX "development_updates_project_idx" ON "development_updates" USING btree ("development_project_id","created_at");--> statement-breakpoint
CREATE INDEX "document_access_logs_version_idx" ON "document_access_logs" USING btree ("document_version_id","created_at");--> statement-breakpoint
CREATE INDEX "document_access_logs_user_idx" ON "document_access_logs" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "document_scan_results_version_idx" ON "document_scan_results" USING btree ("document_version_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "document_versions_doc_version_uq" ON "document_versions" USING btree ("document_id","version_no");--> statement-breakpoint
CREATE UNIQUE INDEX "document_versions_storage_key_uq" ON "document_versions" USING btree ("storage_key");--> statement-breakpoint
CREATE INDEX "documents_pitch_idx" ON "documents" USING btree ("pitch_id","category_key");--> statement-breakpoint
CREATE INDEX "follow_ups_due_open_idx" ON "follow_ups" USING btree ("due_on") WHERE "follow_ups"."completed_at" IS NULL;--> statement-breakpoint
CREATE INDEX "job_outbox_pending_idx" ON "job_outbox" USING btree ("run_after") WHERE "job_outbox"."status" = 'PENDING';--> statement-breakpoint
CREATE INDEX "login_attempts_ip_time_idx" ON "login_attempts" USING btree ("ip","created_at");--> statement-breakpoint
CREATE INDEX "login_attempts_email_time_idx" ON "login_attempts" USING btree ("email_hash","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "lookup_type_key_uq" ON "lookup_values" USING btree ("type","key");--> statement-breakpoint
CREATE INDEX "notifications_user_idx" ON "notifications" USING btree ("user_id","read_at","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "password_reset_token_hash_uq" ON "password_reset_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "pitch_images_pitch_idx" ON "pitch_images" USING btree ("pitch_id");--> statement-breakpoint
CREATE UNIQUE INDEX "pitch_images_storage_key_uq" ON "pitch_images" USING btree ("storage_key");--> statement-breakpoint
CREATE INDEX "pitch_participants_user_idx" ON "pitch_participants" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "pitches_code_uq" ON "pitches" USING btree ("pitch_code");--> statement-breakpoint
CREATE INDEX "pitches_stage_idx" ON "pitches" USING btree ("current_stage_key","stage_entered_at");--> statement-breakpoint
CREATE INDEX "pitches_owner_idx" ON "pitches" USING btree ("current_owner_id");--> statement-breakpoint
CREATE INDEX "pitches_creator_idx" ON "pitches" USING btree ("creator_id");--> statement-breakpoint
CREATE INDEX "pitches_facets_idx" ON "pitches" USING btree ("language_key","genre_key","format_key");--> statement-breakpoint
CREATE INDEX "pitches_created_idx" ON "pitches" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "pitches_title_trgm_idx" ON "pitches" USING gin ("title" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "platform_contacts_platform_idx" ON "platform_contacts" USING btree ("platform_id");--> statement-breakpoint
CREATE UNIQUE INDEX "platform_pitches_round_uq" ON "platform_pitches" USING btree ("pitch_id","platform_id","round_no");--> statement-breakpoint
CREATE INDEX "platform_pitches_platform_status_idx" ON "platform_pitches" USING btree ("platform_id","current_status");--> statement-breakpoint
CREATE INDEX "platform_responses_pp_idx" ON "platform_responses" USING btree ("platform_pitch_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "platforms_name_uq" ON "platforms" USING btree (lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "production_projects_pitch_uq" ON "production_projects" USING btree ("pitch_id");--> statement-breakpoint
CREATE INDEX "production_updates_project_idx" ON "production_updates" USING btree ("production_project_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "rating_categories_key_uq" ON "rating_categories" USING btree ("key");--> statement-breakpoint
CREATE INDEX "ratings_creator_idx" ON "ratings" USING btree ("creator_id","created_at");--> statement-breakpoint
CREATE INDEX "ratings_pitch_idx" ON "ratings" USING btree ("pitch_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ratings_event_reviewer_uq" ON "ratings" USING btree ("workflow_event_id","reviewer_id") WHERE "ratings"."workflow_event_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "roles_key_uq" ON "roles" USING btree ("key");--> statement-breakpoint
CREATE UNIQUE INDEX "saved_filters_user_name_uq" ON "saved_filters" USING btree ("user_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "sessions_token_hash_uq" ON "sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_uq" ON "users" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_def_version_uq" ON "workflow_definitions" USING btree ("name","version");--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_def_one_active_uq" ON "workflow_definitions" USING btree ("is_active") WHERE "workflow_definitions"."is_active" = true;--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_events_pitch_seq_uq" ON "workflow_events" USING btree ("pitch_id","seq");--> statement-breakpoint
CREATE INDEX "workflow_events_actor_idx" ON "workflow_events" USING btree ("actor_id","created_at");--> statement-breakpoint
CREATE INDEX "workflow_events_action_idx" ON "workflow_events" USING btree ("action","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_stage_def_key_uq" ON "workflow_stages" USING btree ("definition_id","key");--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_transition_uq" ON "workflow_transitions" USING btree ("definition_id","from_stage_key","action",coalesce("to_stage_key", ''));