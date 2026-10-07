-- Creator Studio: a writer's full profile, projects with credits, a poster per pitch, and the same pitch going to
-- several production houses (companies) with a record of each send.
--
--  * public_creators gets the profile: photo, experience, bio, IMDB, showreel and other links.
--  * public_creator_credits: the projects a writer has worked on, with the credit they held.
--  * public_draft_sends: one row per (pitch, production house). The pitch is no longer locked after sending.
--    Rows are back-filled from the single-send model this replaces.
--  * public_send_documents: which of a pitch's files has been delivered into which production house, so a file added
--    after pitching is delivered to every house that already has the pitch, exactly once.
--  * creator_portal_pitch_history(): the stage changes of the caller's OWN pitch in a company, without remarks or
--    people — so a writer can follow a pitch's progress while internal review notes stay staff-only.

ALTER TABLE public.public_creators
  ADD COLUMN profile_image_key text,
  ADD COLUMN experience_years integer,
  ADD COLUMN bio varchar(2000),
  ADD COLUMN imdb_url varchar(500),
  ADD COLUMN showreel_url varchar(500),
  ADD COLUMN other_links jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN profile_completed_at timestamp with time zone,
  ADD CONSTRAINT public_creators_experience_ck CHECK (experience_years IS NULL OR experience_years BETWEEN 0 AND 80);
--> statement-breakpoint

CREATE TABLE "public_creator_credits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"creator_id" uuid NOT NULL REFERENCES "public_creators"("id") ON DELETE CASCADE,
	"project_title" varchar(200) NOT NULL,
	"credit" varchar(120) NOT NULL,
	"release_year" integer,
	"link" varchar(500),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "public_creator_credits_year_ck" CHECK ("release_year" IS NULL OR "release_year" BETWEEN 1900 AND 2100)
);
--> statement-breakpoint
CREATE INDEX "public_creator_credits_creator_idx" ON "public_creator_credits" USING btree ("creator_id");--> statement-breakpoint


CREATE TABLE "public_draft_sends" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"draft_id" uuid NOT NULL REFERENCES "public_drafts"("id") ON DELETE CASCADE,
	"creator_id" uuid NOT NULL REFERENCES "public_creators"("id") ON DELETE CASCADE,
	"company_id" uuid NOT NULL,
	"company_pitch_id" uuid NOT NULL,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "public_draft_sends_draft_company_uq" ON "public_draft_sends" USING btree ("draft_id", "company_id");--> statement-breakpoint
CREATE INDEX "public_draft_sends_creator_idx" ON "public_draft_sends" USING btree ("creator_id", "company_id");--> statement-breakpoint

CREATE TABLE "public_send_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"send_id" uuid NOT NULL REFERENCES "public_draft_sends"("id") ON DELETE CASCADE,
	"file_id" uuid NOT NULL REFERENCES "public_draft_files"("id") ON DELETE CASCADE,
	"document_id" uuid NOT NULL,
	"storage_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "public_send_documents_uq" ON "public_send_documents" USING btree ("send_id", "file_id");--> statement-breakpoint

-- Carry over what the single-send model recorded.
INSERT INTO public.public_draft_sends (draft_id, creator_id, company_id, company_pitch_id, sent_at)
SELECT id, creator_id, sent_company_id, sent_pitch_id, coalesce(sent_at, now())
  FROM public.public_drafts
 WHERE sent_company_id IS NOT NULL AND sent_pitch_id IS NOT NULL
ON CONFLICT DO NOTHING;
--> statement-breakpoint

-- A pitch is no longer locked once sent: it can go to more production houses and keep receiving documents.
UPDATE public.public_drafts SET status = 'DRAFT' WHERE status = 'SENT';
--> statement-breakpoint

ALTER TABLE public.public_creator_credits ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.public_draft_sends ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.public_send_documents ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL ON public.public_creator_credits, public.public_draft_sends, public.public_send_documents FROM PUBLIC;--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pitch_app') THEN
    REVOKE ALL ON public.public_creator_credits, public.public_draft_sends, public.public_send_documents FROM pitch_app;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pitch_creator') THEN
    REVOKE ALL ON public.public_creator_credits, public.public_draft_sends, public.public_send_documents FROM pitch_creator;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON public.public_creator_credits, public.public_draft_sends, public.public_send_documents FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON public.public_creator_credits, public.public_draft_sends, public.public_send_documents FROM authenticated;
  END IF;
END $$;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON public.public_creator_credits, public.public_draft_sends, public.public_send_documents TO pitch_platform;--> statement-breakpoint
CREATE POLICY platform_identity ON public.public_creator_credits FOR ALL TO pitch_platform USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY platform_identity ON public.public_draft_sends FOR ALL TO pitch_platform USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY platform_identity ON public.public_send_documents FOR ALL TO pitch_platform USING (true) WITH CHECK (true);--> statement-breakpoint

-- A writer following their own pitch inside a company: only the stage it moved to and when. No remarks, no people.
CREATE FUNCTION public.creator_portal_pitch_history(p_pitch_id uuid)
RETURNS TABLE(to_stage_key varchar, happened_at timestamptz)
LANGUAGE sql SECURITY DEFINER STABLE SET search_path = '' AS $$
  SELECT e.to_stage_key::varchar, e.created_at
    FROM public.workflow_events e
    JOIN public.pitches p ON p.id = e.pitch_id AND p.company_id = e.company_id
   WHERE e.pitch_id = p_pitch_id
     AND p.company_id = public.app_company_id()
     AND p.created_by_creator_id = public.app_creator_id()
     AND e.to_stage_key IS NOT NULL
   ORDER BY e.seq;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.creator_portal_pitch_history(uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.creator_portal_pitch_history(uuid) TO pitch_creator;
