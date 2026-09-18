-- ════════════════════════════════════════════════════════════════════════════
-- 0008  Creator portal profile completion: lets a self-registered creator fill in
--       and later edit their own profile (location, languages, experience, bio,
--       agency, previous companies, website, IMDB/Wikipedia/other links) and add
--       "projects worked on" — the same information staff can enter for a
--       creator via the New Creator form, now entered by the creator themselves.
--
--       creators.profile_completed_at already exists and was already grantable to
--       pitch_creator (0007) — it was simply never set by anything until the
--       profile-completion flow this migration's application code adds. This
--       migration only extends creator_projects, which had no pitch_creator
--       access at all: a creator can now add/edit/archive projects on their OWN
--       profile (creator_id = app_creator_id()), exactly mirroring the
--       created_by_id / created_by_creator_id "who actually entered this" split
--       already used for documents/document_versions/workflow_events in 0007 —
--       creator_id itself (whose profile) is a separate concept from authorship
--       and is untouched here.
--
-- Runs in one transaction (Drizzle migrator): any failure applies nothing.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. creator_projects: allow a portal-authored row ────────────────────────
ALTER TABLE public.creator_projects ALTER COLUMN created_by_id DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE public.creator_projects ADD COLUMN created_by_creator_id uuid;
--> statement-breakpoint
ALTER TABLE public.creator_projects ADD CONSTRAINT creator_projects_created_by_creator_id_tenant_fk
  FOREIGN KEY (company_id, created_by_creator_id) REFERENCES public.creators (company_id, id);
--> statement-breakpoint
ALTER TABLE public.creator_projects ADD CONSTRAINT creator_projects_author_ck
  CHECK ((created_by_id IS NOT NULL) <> (created_by_creator_id IS NOT NULL));
--> statement-breakpoint

-- ── 2. RLS: a creator sees/edits only projects on their OWN profile ─────────
-- creator_id says whose profile the project is on — that is what scopes visibility, regardless of
-- who originally entered it (staff may have added a project on a creator's behalf before the portal
-- existed; the creator can still see and edit it, same as any other profile field staff once filled in).
CREATE POLICY creator_own_projects ON public.creator_projects FOR SELECT TO pitch_creator
  USING (creator_projects.company_id = (SELECT public.app_company_id())
    AND creator_projects.creator_id = (SELECT public.app_creator_id()));
--> statement-breakpoint
CREATE POLICY creator_add_project ON public.creator_projects FOR INSERT TO pitch_creator
  WITH CHECK (creator_projects.company_id = (SELECT public.app_company_id())
    AND creator_projects.creator_id = (SELECT public.app_creator_id())
    AND creator_projects.created_by_creator_id = (SELECT public.app_creator_id()));
--> statement-breakpoint
CREATE POLICY creator_edit_project ON public.creator_projects FOR UPDATE TO pitch_creator
  USING (creator_projects.company_id = (SELECT public.app_company_id())
    AND creator_projects.creator_id = (SELECT public.app_creator_id()))
  WITH CHECK (creator_projects.company_id = (SELECT public.app_company_id())
    AND creator_projects.creator_id = (SELECT public.app_creator_id()));
--> statement-breakpoint
GRANT SELECT, INSERT ON public.creator_projects TO pitch_creator;
--> statement-breakpoint
-- Never creator_id (whose profile this is — fixed at creation) and never created_by_id/created_by_creator_id
-- (authorship, fixed at creation, exactly like documents above). archived_at lets a creator remove a project
-- from their own profile without staff involvement, same as any other profile edit.
GRANT UPDATE (project_name, role, production_company, platform_name, release_year, language_key, genre_key,
  project_status, description, external_links, archived_at, updated_at) ON public.creator_projects TO pitch_creator;
