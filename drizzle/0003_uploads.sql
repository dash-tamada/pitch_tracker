CREATE TYPE "public"."upload_kind" AS ENUM('DOCUMENT', 'IMAGE', 'CREATOR_PHOTO');--> statement-breakpoint
ALTER TYPE "public"."scan_status" ADD VALUE 'NOT_SCANNED';--> statement-breakpoint
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
--> statement-breakpoint
ALTER TABLE "upload_intents" ADD CONSTRAINT "upload_intents_pitch_id_pitches_id_fk" FOREIGN KEY ("pitch_id") REFERENCES "public"."pitches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "upload_intents" ADD CONSTRAINT "upload_intents_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "upload_intents" ADD CONSTRAINT "upload_intents_creator_id_creators_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."creators"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "upload_intents" ADD CONSTRAINT "upload_intents_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "upload_intents_key_uq" ON "upload_intents" USING btree ("quarantine_key");--> statement-breakpoint
CREATE INDEX "upload_intents_user_idx" ON "upload_intents" USING btree ("created_by_id","created_at");--> statement-breakpoint
-- Every new table: least-privilege grant for the app role, RLS on, only the app-server policy, no API-role access.
GRANT SELECT, INSERT, UPDATE ON upload_intents TO pitch_app;
--> statement-breakpoint
ALTER TABLE public.upload_intents ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY app_server_only ON public.upload_intents AS PERMISSIVE FOR ALL TO pitch_app USING (true) WITH CHECK (true);
--> statement-breakpoint
DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON public.upload_intents FROM %I', r);
    END IF;
  END LOOP;
END $$;
