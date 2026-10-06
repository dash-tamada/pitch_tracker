-- Platform-wide creators: anyone can register with a mobile number (verified by a WhatsApp code), build a profile,
-- write pitch drafts and upload material. Nothing here belongs to a company; sending a draft to a registered
-- company (a later release) is what creates company records.
--
-- These tables are reached only by the identity role (pitch_platform), like sign-in. They hold no company data and
-- are invisible to the company role (pitch_app) and to the Supabase API roles.

CREATE TABLE "public_creators" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"mobile_e164" varchar(16) NOT NULL,
	"full_name" varchar(120) NOT NULL,
	"creator_type" varchar(30) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_login_at" timestamp with time zone,
	"disabled_at" timestamp with time zone,
	CONSTRAINT "public_creators_mobile_format_ck" CHECK ("mobile_e164" ~ '^\+[1-9][0-9]{7,14}$')
);
--> statement-breakpoint
CREATE UNIQUE INDEX "public_creators_mobile_uq" ON "public_creators" USING btree ("mobile_e164");--> statement-breakpoint

CREATE TABLE "public_creator_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"creator_id" uuid NOT NULL REFERENCES "public_creators"("id") ON DELETE CASCADE,
	"token_hash" "bytea" NOT NULL,
	"ip" "inet",
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE UNIQUE INDEX "public_creator_sessions_token_uq" ON "public_creator_sessions" USING btree ("token_hash");--> statement-breakpoint

CREATE TABLE "public_drafts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"creator_id" uuid NOT NULL REFERENCES "public_creators"("id") ON DELETE CASCADE,
	"title" varchar(200) NOT NULL,
	"logline" varchar(500),
	"short_synopsis" text,
	"detailed_synopsis" text,
	"format_key" varchar(60),
	"language_key" varchar(60),
	"genre_key" varchar(60),
	"episode_count" integer,
	"episode_duration_min" integer,
	"target_audience" varchar(200),
	"notes" text,
	"status" varchar(12) DEFAULT 'DRAFT' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "public_drafts_status_ck" CHECK ("status" IN ('DRAFT', 'SENT'))
);
--> statement-breakpoint
CREATE INDEX "public_drafts_creator_idx" ON "public_drafts" USING btree ("creator_id", "updated_at");--> statement-breakpoint

CREATE TABLE "public_draft_uploads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"draft_id" uuid NOT NULL REFERENCES "public_drafts"("id") ON DELETE CASCADE,
	"creator_id" uuid NOT NULL REFERENCES "public_creators"("id") ON DELETE CASCADE,
	"category_key" varchar(60) NOT NULL,
	"title" varchar(200) NOT NULL,
	"original_filename" varchar(255) NOT NULL,
	"declared_size_bytes" bigint NOT NULL,
	"quarantine_key" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone,
	"rejected_reason" varchar(200),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

CREATE TABLE "public_draft_files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"draft_id" uuid NOT NULL REFERENCES "public_drafts"("id") ON DELETE CASCADE,
	"creator_id" uuid NOT NULL REFERENCES "public_creators"("id") ON DELETE CASCADE,
	"category_key" varchar(60) NOT NULL,
	"title" varchar(200) NOT NULL,
	"original_filename" varchar(255) NOT NULL,
	"detected_mime" varchar(120) NOT NULL,
	"size_bytes" bigint NOT NULL,
	"sha256" varchar(64) NOT NULL,
	"storage_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "public_draft_files_draft_idx" ON "public_draft_files" USING btree ("draft_id");--> statement-breakpoint

ALTER TABLE public.public_creators ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.public_creator_sessions ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.public_drafts ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.public_draft_uploads ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.public_draft_files ENABLE ROW LEVEL SECURITY;--> statement-breakpoint

REVOKE ALL ON public.public_creators, public.public_creator_sessions, public.public_drafts, public.public_draft_uploads, public.public_draft_files FROM PUBLIC;--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pitch_app') THEN
    REVOKE ALL ON public.public_creators, public.public_creator_sessions, public.public_drafts, public.public_draft_uploads, public.public_draft_files FROM pitch_app;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pitch_creator') THEN
    REVOKE ALL ON public.public_creators, public.public_creator_sessions, public.public_drafts, public.public_draft_uploads, public.public_draft_files FROM pitch_creator;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON public.public_creators, public.public_creator_sessions, public.public_drafts, public.public_draft_uploads, public.public_draft_files FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON public.public_creators, public.public_creator_sessions, public.public_drafts, public.public_draft_uploads, public.public_draft_files FROM authenticated;
  END IF;
END $$;--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE, DELETE ON public.public_creators, public.public_creator_sessions, public.public_drafts,
  public.public_draft_uploads, public.public_draft_files TO pitch_platform;--> statement-breakpoint
CREATE POLICY platform_identity ON public.public_creators FOR ALL TO pitch_platform USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY platform_identity ON public.public_creator_sessions FOR ALL TO pitch_platform USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY platform_identity ON public.public_drafts FOR ALL TO pitch_platform USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY platform_identity ON public.public_draft_uploads FOR ALL TO pitch_platform USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY platform_identity ON public.public_draft_files FOR ALL TO pitch_platform USING (true) WITH CHECK (true);
