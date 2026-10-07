-- "New pitch received" alert for company staff. A pitch that arrived from outside (creator portal or Creator Studio) is shown to
-- staff as a pop-up until ANYONE in the company acknowledges it; this table records that acknowledgement (one row per pitch,
-- company-wide). Pitches that already exist when this runs count as already seen, so nobody is greeted by a backlog.

CREATE TABLE public.pitch_intake_acks (
	"company_id" uuid NOT NULL DEFAULT public.app_company_id() REFERENCES public.companies("id"),
	"pitch_id" uuid PRIMARY KEY REFERENCES public.pitches("id") ON DELETE CASCADE,
	"acknowledged_by" uuid REFERENCES public.users("id"),
	"acknowledged_at" timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX pitch_intake_acks_company_idx ON public.pitch_intake_acks (company_id);
--> statement-breakpoint
INSERT INTO public.pitch_intake_acks (company_id, pitch_id)
SELECT company_id, id FROM public.pitches WHERE submitted_via_portal = true
ON CONFLICT DO NOTHING;
--> statement-breakpoint
ALTER TABLE public.pitch_intake_acks ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON public.pitch_intake_acks FROM PUBLIC;
--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN REVOKE ALL ON public.pitch_intake_acks FROM anon; END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN REVOKE ALL ON public.pitch_intake_acks FROM authenticated; END IF;
END $$;
--> statement-breakpoint
GRANT SELECT, INSERT ON public.pitch_intake_acks TO pitch_app;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON public.pitch_intake_acks AS PERMISSIVE FOR ALL TO pitch_app
  USING (company_id = (SELECT public.app_company_id())) WITH CHECK (company_id = (SELECT public.app_company_id()));
