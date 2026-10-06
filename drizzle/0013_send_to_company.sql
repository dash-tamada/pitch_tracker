-- Phase 2 of platform-wide creators: sending a draft to a company.
--
--  * creators.public_creator_id links a company's creator record to the platform-wide creator it came from. A creator
--    created this way signs in through /creator, never the company portal, so it has no email or password: the identity
--    check accepts "linked to a platform-wide creator" as an alternative to "has an email and a password".
--  * companies.accepts_creator_submissions lets a company opt out of appearing in the "send to a company" list.
--  * public_drafts remembers where a draft was sent.

ALTER TABLE public.creators ADD COLUMN public_creator_id uuid;
--> statement-breakpoint
CREATE UNIQUE INDEX creators_company_public_creator_uq ON public.creators (company_id, public_creator_id) WHERE public_creator_id IS NOT NULL;
--> statement-breakpoint
ALTER TABLE public.creators DROP CONSTRAINT creators_portal_identity_ck;
--> statement-breakpoint
ALTER TABLE public.creators ADD CONSTRAINT creators_portal_identity_ck
  CHECK (NOT self_registered
         OR (email_normalized IS NOT NULL AND password_hash IS NOT NULL)
         OR public_creator_id IS NOT NULL);
--> statement-breakpoint
ALTER TABLE public.companies ADD COLUMN accepts_creator_submissions boolean NOT NULL DEFAULT true;
--> statement-breakpoint
ALTER TABLE public.public_drafts ADD COLUMN sent_company_id uuid, ADD COLUMN sent_pitch_id uuid, ADD COLUMN sent_at timestamp with time zone;
