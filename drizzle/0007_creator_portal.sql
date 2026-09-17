-- ════════════════════════════════════════════════════════════════════════════
-- 0007  Creator portal: self-service registration, login, pitch submission and
--       document upload for creators — a structurally separate identity and
--       authorization path from staff ("Path A" in HANDOFF.md).
--
-- Isolation model:
--  * a NEW database role, pitch_creator, distinct from both pitch_app (company staff)
--    and pitch_platform (staff identity). A compromised/buggy creator-portal code path
--    therefore cannot read staff credentials, other companies' data, or (with one
--    narrow, deliberate exception below) even other creators' rows in its own company.
--  * every creator-portal statement is transaction-scoped to BOTH app.company_id and
--    app.creator_id (see CreatorPool in src/server/db/client.ts) — row-level security
--    enforces both, so a stolen/forged company id alone is not enough to reach a row.
--  * pitch_app (company staff) keeps full visibility of portal-submitted content (it is
--    their pipeline too) but is blocked — by trigger, exactly like users.password_hash —
--    from ever reading or writing a creator's credential columns.
--  * the registration/login link is resolved through one SECURITY DEFINER function so
--    pitch_creator needs no grant at all on the companies table, which stays exactly as
--    off-limits to it as it already is to pitch_app for other companies' rows.
--
-- Runs in one transaction (Drizzle migrator): any failure applies nothing.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. Role ───────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pitch_creator') THEN
    CREATE ROLE pitch_creator NOLOGIN NOINHERIT;   -- password + LOGIN are set by the operator (npm run setup:local), exactly like pitch_platform
  END IF;
END $$;
--> statement-breakpoint
ALTER ROLE pitch_creator SET search_path = public, extensions;
--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO pitch_creator;
--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'extensions') THEN GRANT USAGE ON SCHEMA extensions TO pitch_creator; END IF;
END $$;
--> statement-breakpoint

-- ── 2. Types ─────────────────────────────────────────────────────────────────
CREATE TYPE "public"."creator_portal_status" AS ENUM('ACTIVE', 'DISABLED');
--> statement-breakpoint

-- ── 3. Tenant + creator context helper ──────────────────────────────────────
-- Mirrors app_company_id(): every pitch_creator statement runs inside a transaction whose
-- first statement sets BOTH transaction-local settings (see CreatorPool).
CREATE FUNCTION public.app_creator_id() RETURNS uuid
LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT nullif(current_setting('app.creator_id', true), '')::uuid
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.app_creator_id() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.app_creator_id() TO pitch_creator, pitch_app;
--> statement-breakpoint
-- Every RLS policy and company_id column default below reads app_company_id() — pitch_creator needs the
-- same EXECUTE grant pitch_app/pitch_platform already have (0006_multi_tenant.sql), or every one of those
-- checks fails outright with "permission denied for function app_company_id" the instant it is evaluated.
GRANT EXECUTE ON FUNCTION public.app_company_id() TO pitch_creator;
--> statement-breakpoint

-- ── 4. companies: the registration/login link ───────────────────────────────
ALTER TABLE public.companies ADD COLUMN creator_portal_token_hash bytea;
--> statement-breakpoint
CREATE UNIQUE INDEX companies_creator_portal_token_hash_uq ON public.companies (creator_portal_token_hash) WHERE creator_portal_token_hash IS NOT NULL;
--> statement-breakpoint
GRANT UPDATE (creator_portal_token_hash) ON public.companies TO pitch_app;
--> statement-breakpoint

-- Resolves a hashed registration/login token to a company id, with no other grant on
-- companies at all needed by pitch_creator (the one deliberate exception mentioned above:
-- this function, not a table grant, is what crosses the role boundary, and only in this
-- one narrow direction). Returns NULL — never an error — for an unknown or blank token,
-- so a probing request cannot distinguish "wrong token" from "no such company".
CREATE FUNCTION public.resolve_creator_portal_company(p_token_hash bytea) RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT id FROM public.companies
   WHERE creator_portal_token_hash = p_token_hash
     AND status NOT IN ('SUSPENDED', 'EXPIRED', 'ARCHIVED')
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.resolve_creator_portal_company(bytea) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.resolve_creator_portal_company(bytea) TO pitch_creator;
--> statement-breakpoint

-- ── 5. creators: self-registration + auth columns ───────────────────────────
ALTER TABLE public.creators ALTER COLUMN created_by_id DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE public.creators
  ADD COLUMN self_registered boolean NOT NULL DEFAULT false,
  ADD COLUMN password_hash text,
  ADD COLUMN password_changed_at timestamptz,
  ADD COLUMN last_login_at timestamptz,
  ADD COLUMN failed_login_count integer NOT NULL DEFAULT 0,
  ADD COLUMN locked_until timestamptz,
  ADD COLUMN portal_status public.creator_portal_status NOT NULL DEFAULT 'ACTIVE',
  ADD COLUMN profile_completed_at timestamptz;
--> statement-breakpoint
ALTER TABLE public.creators ADD CONSTRAINT creators_author_ck CHECK ((created_by_id IS NOT NULL) <> self_registered);
--> statement-breakpoint
ALTER TABLE public.creators ADD CONSTRAINT creators_portal_identity_ck
  CHECK (NOT self_registered OR (email_normalized IS NOT NULL AND password_hash IS NOT NULL));
--> statement-breakpoint

-- Unlike `users` (written from day one with explicit column lists everywhere so a SELECT-column restriction
-- was free), the existing creators/pitches/documents/search modules do plain `db.select().from(creators)` in
-- many places — retrofitting a column-restricted SELECT here would break that already-correct, unrelated code
-- across several modules for comparatively little benefit, since toCreatorDto() already never serializes these
-- fields to any API response. So company staff keeps full SELECT on creators (unchanged from before this
-- migration); what changes is that staff can no longer WRITE credentials — enforced below by an INSERT guard
-- trigger (staff still needs table-level INSERT for the ORM's DEFAULT-column pattern) and a column-restricted
-- UPDATE grant, the same two mechanisms that already protect users.password_hash.
--> statement-breakpoint
CREATE FUNCTION public.creators_company_insert_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF current_user = 'pitch_app' AND (
       NEW.password_hash IS NOT NULL OR NEW.self_registered OR NEW.failed_login_count <> 0 OR NEW.locked_until IS NOT NULL
    OR NEW.last_login_at IS NOT NULL OR NEW.password_changed_at IS NOT NULL OR NEW.portal_status <> 'ACTIVE') THEN
    RAISE EXCEPTION 'IDENTITY_FIELDS: company work cannot set creator-portal credentials or sign-in state'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.creators_company_insert_guard() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER creators_company_insert_guard BEFORE INSERT ON public.creators FOR EACH ROW EXECUTE FUNCTION public.creators_company_insert_guard();
--> statement-breakpoint
-- 0001_integrity granted pitch_app an unrestricted UPDATE on creators (part of a blanket multi-table
-- grant). A narrower column-list GRANT is additive in Postgres, not a restriction — it would not remove
-- pitch_app's pre-existing ability to write password_hash, portal_status, self_registered, etc. Revoke the
-- broad grant first so the column-restricted grant below is the actual effective privilege.
REVOKE UPDATE ON public.creators FROM pitch_app;
--> statement-breakpoint
-- portal_status IS included here (deliberately): Company Admin disabling a misbehaving/departed creator's
-- portal access is a real, expected staff action. It is excluded from pitch_creator's own UPDATE grant
-- below instead — a creator must never be able to re-enable itself once disabled.
GRANT UPDATE (creator_type, full_name, name_normalized, mobile_e164, email_normalized, profile_image_key, location, language_keys,
  years_experience, bio, agency, previous_companies, website, social_links, notes, consent_basis,
  consent_recorded_at, archived_at, updated_at, portal_status) ON public.creators TO pitch_app;
--> statement-breakpoint

-- pitch_creator: only ever its own row (id = app_creator_id()), except registration, where no creator
-- session exists yet — that INSERT is instead scoped to "a fresh, correctly-shaped self-registered row".
CREATE POLICY creator_register ON public.creators FOR INSERT TO pitch_creator
  WITH CHECK (company_id = (SELECT public.app_company_id()) AND self_registered AND created_by_id IS NULL);
--> statement-breakpoint
CREATE POLICY creator_self_select ON public.creators FOR SELECT TO pitch_creator
  USING (company_id = (SELECT public.app_company_id()) AND id = (SELECT public.app_creator_id()));
--> statement-breakpoint
CREATE POLICY creator_self_update ON public.creators FOR UPDATE TO pitch_creator
  USING (company_id = (SELECT public.app_company_id()) AND id = (SELECT public.app_creator_id()))
  WITH CHECK (company_id = (SELECT public.app_company_id()) AND id = (SELECT public.app_creator_id()));
--> statement-breakpoint
GRANT SELECT, INSERT ON public.creators TO pitch_creator;
--> statement-breakpoint
-- Never portal_status (staff-only kill switch — a disabled creator must not be able to re-enable itself)
-- and never created_by_id/self_registered (identity of authorship, fixed at creation).
GRANT UPDATE (full_name, name_normalized, creator_type, mobile_e164, email_normalized, location, language_keys, years_experience,
  bio, agency, previous_companies, website, social_links, profile_image_key, profile_completed_at, password_hash,
  password_changed_at, last_login_at, failed_login_count, locked_until, updated_at) ON public.creators TO pitch_creator;
--> statement-breakpoint

-- ── 6. creator_sessions ──────────────────────────────────────────────────────
CREATE TABLE public.creator_sessions (
  company_id uuid NOT NULL DEFAULT public.app_company_id() REFERENCES public.companies(id),
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id uuid NOT NULL,
  token_hash bytea NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  ip inet,
  user_agent varchar(512),
  CONSTRAINT creator_sessions_creator_fk FOREIGN KEY (company_id, creator_id) REFERENCES public.creators (company_id, id)
);
--> statement-breakpoint
CREATE UNIQUE INDEX creator_sessions_token_hash_uq ON public.creator_sessions (token_hash);
--> statement-breakpoint
CREATE INDEX creator_sessions_creator_idx ON public.creator_sessions (creator_id);
--> statement-breakpoint
ALTER TABLE public.creator_sessions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
-- Deliberately NO policy and NO grant for pitch_app or pitch_platform: creator session tokens are exactly
-- as off-limits to company staff as staff session tokens are to company staff's own read access.
CREATE POLICY creator_register_session ON public.creator_sessions FOR INSERT TO pitch_creator
  WITH CHECK (company_id = (SELECT public.app_company_id()) AND creator_id = (SELECT public.app_creator_id()));
--> statement-breakpoint
CREATE POLICY creator_own_sessions ON public.creator_sessions FOR SELECT TO pitch_creator
  USING (company_id = (SELECT public.app_company_id()) AND creator_id = (SELECT public.app_creator_id()));
--> statement-breakpoint
CREATE POLICY creator_own_sessions_update ON public.creator_sessions FOR UPDATE TO pitch_creator
  USING (company_id = (SELECT public.app_company_id()) AND creator_id = (SELECT public.app_creator_id()))
  WITH CHECK (company_id = (SELECT public.app_company_id()) AND creator_id = (SELECT public.app_creator_id()));
--> statement-breakpoint
GRANT SELECT, INSERT ON public.creator_sessions TO pitch_creator;
--> statement-breakpoint
GRANT UPDATE (last_seen_at, revoked_at) ON public.creator_sessions TO pitch_creator;
--> statement-breakpoint

-- ── 6b. Login and session lookup — the same bootstrapping problem resolve_creator_portal_company
-- solves, one level in. creator_self_select/creator_own_sessions both require app_creator_id(), but
-- that is exactly the thing login and session resolution are trying to discover — a creator cannot look
-- itself up by email, and cannot look its own session up by token, before it is known who "itself" is.
-- Both functions are scoped to the company already resolved from the portal link (never a parameter, so
-- neither can be used to browse another company's creators or sessions) and each returns at most the ONE
-- row matching an exact email or exact token hash — never a list — so this is not the general "browse
-- other creators" visibility that creator_self_select deliberately withholds; it is the same one-row,
-- caller-must-already-know-the-key shape as resolve_creator_portal_company itself.
CREATE FUNCTION public.creator_portal_login_lookup(p_email varchar) RETURNS TABLE(
  id uuid, password_hash text, self_registered boolean, portal_status public.creator_portal_status,
  locked_until timestamptz, failed_login_count int, archived_at timestamptz, profile_completed_at timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT c.id, c.password_hash, c.self_registered, c.portal_status, c.locked_until, c.failed_login_count, c.archived_at, c.profile_completed_at
    FROM public.creators c
   WHERE c.company_id = public.app_company_id() AND c.email_normalized = lower(trim(p_email))
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.creator_portal_login_lookup(varchar) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.creator_portal_login_lookup(varchar) TO pitch_creator;
--> statement-breakpoint

CREATE FUNCTION public.creator_portal_resolve_session(p_token_hash bytea) RETURNS TABLE(
  creator_id uuid, session_id uuid, expires_at timestamptz, revoked_at timestamptz, last_seen_at timestamptz,
  portal_status public.creator_portal_status, archived_at timestamptz, profile_completed_at timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT s.creator_id, s.id, s.expires_at, s.revoked_at, s.last_seen_at, c.portal_status, c.archived_at, c.profile_completed_at
    FROM public.creator_sessions s JOIN public.creators c ON c.id = s.creator_id AND c.company_id = s.company_id
   WHERE s.company_id = public.app_company_id() AND s.token_hash = p_token_hash
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.creator_portal_resolve_session(bytea) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.creator_portal_resolve_session(bytea) TO pitch_creator;
--> statement-breakpoint

-- ── 7. pitches: portal submission ───────────────────────────────────────────
ALTER TABLE public.pitches ALTER COLUMN created_by_id DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE public.pitches
  ADD COLUMN created_by_creator_id uuid,
  ADD COLUMN submitted_via_portal boolean NOT NULL DEFAULT false;
--> statement-breakpoint
ALTER TABLE public.pitches ADD CONSTRAINT pitches_created_by_creator_id_tenant_fk
  FOREIGN KEY (company_id, created_by_creator_id) REFERENCES public.creators (company_id, id);
--> statement-breakpoint
ALTER TABLE public.pitches ADD CONSTRAINT pitches_author_ck CHECK (
  (created_by_id IS NOT NULL) <> (created_by_creator_id IS NOT NULL)
  AND submitted_via_portal = (created_by_creator_id IS NOT NULL));
--> statement-breakpoint
-- pitch_app already has full CRUD on pitches (tenant_isolation policy from 0006) and therefore already
-- sees the new columns; no separate grant/policy change needed there.
CREATE POLICY creator_submit_pitch ON public.pitches FOR INSERT TO pitch_creator
  WITH CHECK (pitches.company_id = (SELECT public.app_company_id())
    AND pitches.created_by_creator_id = (SELECT public.app_creator_id())
    AND pitches.creator_id = (SELECT public.app_creator_id())
    AND pitches.submitted_via_portal);
--> statement-breakpoint
CREATE POLICY creator_own_pitches ON public.pitches FOR SELECT TO pitch_creator
  USING (pitches.company_id = (SELECT public.app_company_id()) AND pitches.created_by_creator_id = (SELECT public.app_creator_id()));
--> statement-breakpoint
GRANT SELECT, INSERT ON public.pitches TO pitch_creator;
--> statement-breakpoint
-- No UPDATE grant: a creator cannot edit pitch details after submitting, and (more importantly) cannot
-- move its own stage/owner — only the workflow engine, running as pitch_app, ever does that.

-- ── 8. workflow_events: the one event a creator can ever write ──────────────
ALTER TABLE public.workflow_events ALTER COLUMN actor_id DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE public.workflow_events ADD COLUMN actor_creator_id uuid;
--> statement-breakpoint
ALTER TABLE public.workflow_events ADD CONSTRAINT workflow_events_actor_creator_id_tenant_fk
  FOREIGN KEY (company_id, actor_creator_id) REFERENCES public.creators (company_id, id);
--> statement-breakpoint
ALTER TABLE public.workflow_events ADD CONSTRAINT workflow_events_author_ck CHECK ((actor_id IS NOT NULL) <> (actor_creator_id IS NOT NULL));
--> statement-breakpoint
-- Deliberately no SELECT for pitch_creator: internal review remarks, rejection reasons and reviewer
-- identities stay staff-only. A creator's portal UI reads status only from the pitches projection.
CREATE POLICY creator_submit_event ON public.workflow_events FOR INSERT TO pitch_creator
  WITH CHECK (workflow_events.company_id = (SELECT public.app_company_id())
    AND workflow_events.actor_creator_id = (SELECT public.app_creator_id())
    AND workflow_events.action = 'SUBMIT' AND workflow_events.seq = 1 AND workflow_events.from_stage_key IS NULL
    AND EXISTS (SELECT 1 FROM public.pitches p WHERE p.id = workflow_events.pitch_id AND p.company_id = workflow_events.company_id
                AND p.created_by_creator_id = (SELECT public.app_creator_id())));
--> statement-breakpoint
GRANT INSERT ON public.workflow_events TO pitch_creator;
--> statement-breakpoint

-- ── 9. documents / document_versions: creator-facing upload path ───────────
ALTER TABLE public.documents ALTER COLUMN created_by_id DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE public.documents ADD COLUMN created_by_creator_id uuid;
--> statement-breakpoint
ALTER TABLE public.documents ADD CONSTRAINT documents_created_by_creator_id_tenant_fk
  FOREIGN KEY (company_id, created_by_creator_id) REFERENCES public.creators (company_id, id);
--> statement-breakpoint
ALTER TABLE public.documents ADD CONSTRAINT documents_author_ck CHECK ((created_by_id IS NOT NULL) <> (created_by_creator_id IS NOT NULL));
--> statement-breakpoint
CREATE POLICY creator_own_documents ON public.documents FOR SELECT TO pitch_creator
  USING (documents.company_id = (SELECT public.app_company_id())
    AND EXISTS (SELECT 1 FROM public.pitches p WHERE p.id = documents.pitch_id AND p.company_id = documents.company_id
                AND p.created_by_creator_id = (SELECT public.app_creator_id())));
--> statement-breakpoint
-- "Rejected pitches cannot receive uploads" is read directly off the pitches projection
-- (current_stage_key), not workflow_events — pitch_creator has no SELECT on workflow_events at all
-- (see §8), so the check has to use a column it is actually allowed to read.
CREATE POLICY creator_add_document ON public.documents FOR INSERT TO pitch_creator
  WITH CHECK (documents.company_id = (SELECT public.app_company_id()) AND documents.created_by_creator_id = (SELECT public.app_creator_id())
    AND EXISTS (SELECT 1 FROM public.pitches p WHERE p.id = documents.pitch_id AND p.company_id = documents.company_id
                AND p.created_by_creator_id = (SELECT public.app_creator_id())
                AND p.current_stage_key <> 'REJECTED'));
--> statement-breakpoint
CREATE POLICY creator_set_current_version ON public.documents FOR UPDATE TO pitch_creator
  USING (documents.company_id = (SELECT public.app_company_id())
    AND EXISTS (SELECT 1 FROM public.pitches p WHERE p.id = documents.pitch_id AND p.company_id = documents.company_id
                AND p.created_by_creator_id = (SELECT public.app_creator_id())))
  WITH CHECK (documents.company_id = (SELECT public.app_company_id())
    AND EXISTS (SELECT 1 FROM public.pitches p WHERE p.id = documents.pitch_id AND p.company_id = documents.company_id
                AND p.created_by_creator_id = (SELECT public.app_creator_id())));
--> statement-breakpoint
GRANT SELECT, INSERT ON public.documents TO pitch_creator;
--> statement-breakpoint
GRANT UPDATE (current_version_id, updated_at) ON public.documents TO pitch_creator;
--> statement-breakpoint

ALTER TABLE public.document_versions ALTER COLUMN uploaded_by_id DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE public.document_versions ADD COLUMN uploaded_by_creator_id uuid;
--> statement-breakpoint
ALTER TABLE public.document_versions ADD CONSTRAINT document_versions_uploaded_by_creator_id_tenant_fk
  FOREIGN KEY (company_id, uploaded_by_creator_id) REFERENCES public.creators (company_id, id);
--> statement-breakpoint
ALTER TABLE public.document_versions ADD CONSTRAINT document_versions_author_ck
  CHECK ((uploaded_by_id IS NOT NULL) <> (uploaded_by_creator_id IS NOT NULL));
--> statement-breakpoint
CREATE POLICY creator_own_document_versions ON public.document_versions FOR SELECT TO pitch_creator
  USING (document_versions.company_id = (SELECT public.app_company_id())
    AND EXISTS (SELECT 1 FROM public.documents d JOIN public.pitches p ON p.id = d.pitch_id
                WHERE d.id = document_versions.document_id AND d.company_id = document_versions.company_id
                AND p.company_id = document_versions.company_id
                AND p.created_by_creator_id = (SELECT public.app_creator_id())));
--> statement-breakpoint
CREATE POLICY creator_add_document_version ON public.document_versions FOR INSERT TO pitch_creator
  WITH CHECK (document_versions.company_id = (SELECT public.app_company_id())
    AND document_versions.uploaded_by_creator_id = (SELECT public.app_creator_id())
    AND EXISTS (SELECT 1 FROM public.documents d JOIN public.pitches p ON p.id = d.pitch_id
                WHERE d.id = document_versions.document_id AND d.company_id = document_versions.company_id
                AND p.company_id = document_versions.company_id
                AND p.created_by_creator_id = (SELECT public.app_creator_id())
                AND p.current_stage_key <> 'REJECTED'));
--> statement-breakpoint
GRANT SELECT, INSERT ON public.document_versions TO pitch_creator;
--> statement-breakpoint

ALTER TABLE public.document_access_logs ALTER COLUMN user_id DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE public.document_access_logs ADD COLUMN creator_id uuid;
--> statement-breakpoint
ALTER TABLE public.document_access_logs ADD CONSTRAINT document_access_logs_creator_id_tenant_fk
  FOREIGN KEY (company_id, creator_id) REFERENCES public.creators (company_id, id);
--> statement-breakpoint
ALTER TABLE public.document_access_logs ADD CONSTRAINT document_access_logs_actor_ck
  CHECK ((user_id IS NOT NULL) <> (creator_id IS NOT NULL));
--> statement-breakpoint
-- Write-only for pitch_creator: "who downloaded this script" is a staff (pitch_app) report, not a
-- creator-facing one, so no SELECT policy is granted here even for the creator's own rows.
CREATE POLICY creator_log_own_access ON public.document_access_logs FOR INSERT TO pitch_creator
  WITH CHECK (document_access_logs.company_id = (SELECT public.app_company_id())
    AND document_access_logs.creator_id = (SELECT public.app_creator_id())
    AND EXISTS (SELECT 1 FROM public.documents d JOIN public.pitches p ON p.id = d.pitch_id
                WHERE p.company_id = document_access_logs.company_id AND p.created_by_creator_id = (SELECT public.app_creator_id())
                AND EXISTS (SELECT 1 FROM public.document_versions dv WHERE dv.id = document_access_logs.document_version_id AND dv.document_id = d.id)));
--> statement-breakpoint
GRANT INSERT ON public.document_access_logs TO pitch_creator;
--> statement-breakpoint

-- ── 10. upload_intents: the quarantine-and-validate upload path, extended for creators ──────
-- Same two-phase flow staff use (issue a signed quarantine URL → browser uploads → /complete
-- re-reads the bytes, content-sniffs the type, hashes, moves to a server-chosen key) — a creator
-- never gets a storage credential directly, and nothing becomes a real document/document_version
-- row until the server has independently validated the bytes.
ALTER TABLE public.upload_intents ALTER COLUMN created_by_id DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE public.upload_intents ADD COLUMN created_by_creator_id uuid;
--> statement-breakpoint
ALTER TABLE public.upload_intents ADD CONSTRAINT upload_intents_created_by_creator_id_tenant_fk
  FOREIGN KEY (company_id, created_by_creator_id) REFERENCES public.creators (company_id, id);
--> statement-breakpoint
ALTER TABLE public.upload_intents ADD CONSTRAINT upload_intents_author_ck
  CHECK ((created_by_id IS NOT NULL) <> (created_by_creator_id IS NOT NULL));
--> statement-breakpoint
CREATE POLICY creator_own_upload_intents ON public.upload_intents FOR SELECT TO pitch_creator
  USING (upload_intents.company_id = (SELECT public.app_company_id()) AND upload_intents.created_by_creator_id = (SELECT public.app_creator_id()));
--> statement-breakpoint
-- Only ever kind = 'DOCUMENT' (never IMAGE or CREATOR_PHOTO) for the portal, and only against a pitch the
-- creator owns that is not rejected — same "read it off the pitches projection" reasoning as documents above.
CREATE POLICY creator_create_upload_intent ON public.upload_intents FOR INSERT TO pitch_creator
  WITH CHECK (upload_intents.company_id = (SELECT public.app_company_id())
    AND upload_intents.created_by_creator_id = (SELECT public.app_creator_id())
    AND upload_intents.kind = 'DOCUMENT'
    AND EXISTS (SELECT 1 FROM public.pitches p WHERE p.id = upload_intents.pitch_id AND p.company_id = upload_intents.company_id
                AND p.created_by_creator_id = (SELECT public.app_creator_id()) AND p.current_stage_key <> 'REJECTED'));
--> statement-breakpoint
-- Only completedAt/rejectedReason ever change after creation (set once, by /complete) — never the
-- declared target, size or quarantine key, which would let a validated upload be redirected in place.
CREATE POLICY creator_finish_upload_intent ON public.upload_intents FOR UPDATE TO pitch_creator
  USING (upload_intents.company_id = (SELECT public.app_company_id()) AND upload_intents.created_by_creator_id = (SELECT public.app_creator_id()))
  WITH CHECK (upload_intents.company_id = (SELECT public.app_company_id()) AND upload_intents.created_by_creator_id = (SELECT public.app_creator_id()));
--> statement-breakpoint
GRANT SELECT, INSERT ON public.upload_intents TO pitch_creator;
--> statement-breakpoint
GRANT UPDATE (completed_at, rejected_reason) ON public.upload_intents TO pitch_creator;
--> statement-breakpoint

-- ── 11. Reference data the portal form needs (read-only, company-wide) ─────
CREATE POLICY creator_read_lookups ON public.lookup_values FOR SELECT TO pitch_creator
  USING (company_id = (SELECT public.app_company_id()));
--> statement-breakpoint
GRANT SELECT ON public.lookup_values TO pitch_creator;
--> statement-breakpoint
CREATE POLICY creator_read_workflow_definitions ON public.workflow_definitions FOR SELECT TO pitch_creator
  USING (company_id = (SELECT public.app_company_id()));
--> statement-breakpoint
GRANT SELECT ON public.workflow_definitions TO pitch_creator;
--> statement-breakpoint
CREATE POLICY creator_read_workflow_stages ON public.workflow_stages FOR SELECT TO pitch_creator
  USING (company_id = (SELECT public.app_company_id()));
--> statement-breakpoint
GRANT SELECT ON public.workflow_stages TO pitch_creator;
--> statement-breakpoint

-- ── 12. Staff-only bookkeeping a portal submission still needs ─────────────
-- pitch_creator has no grant at all on pitch_code_counters, companies, subscriptions or plans (by
-- design — those stay exactly as staff-only as they already are). Both operations below are
-- narrow, single-purpose SECURITY DEFINER functions (owned by the migrator role, which owns every
-- table here and therefore bypasses RLS as the table owner — mirrors resolve_creator_portal_company
-- above) so a portal request can still get a pitch code and a plan-limit check without pitch_creator
-- ever touching those tables directly. Neither function inserts into pitches/workflow_events/documents/
-- document_versions itself — those inserts still happen as pitch_creator, so the RLS policies in
-- §7-§10 are the real, load-bearing checks on the content; these functions only gate/allocate.
CREATE FUNCTION public.creator_portal_prepare_submission() RETURNS TABLE(pitch_code varchar, workflow_definition_id uuid, initial_stage_key varchar)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_company_id uuid := public.app_company_id();
  v_creator_id uuid := public.app_creator_id();
  v_year int := extract(year from now())::int;
  v_last_value int;
  v_prefix text;
  v_code varchar;
  v_max_pitches int;
  v_active_count int;
  v_sub_status text;
  v_def_id uuid;
  v_initial varchar;
BEGIN
  IF v_company_id IS NULL OR v_creator_id IS NULL THEN
    RAISE EXCEPTION 'creator_portal_prepare_submission: no creator session';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.creators c WHERE c.id = v_creator_id AND c.company_id = v_company_id
                  AND c.portal_status = 'ACTIVE' AND c.archived_at IS NULL) THEN
    RAISE EXCEPTION 'creator_portal_prepare_submission: creator account is not active';
  END IF;

  -- Same per-company serialization staff pitch creation uses (tenancy/limits.ts lockCompanyMetric),
  -- so two concurrent portal submissions cannot both slip past the plan limit.
  PERFORM pg_advisory_xact_lock(hashtext('pitches:' || v_company_id::text));

  SELECT s.status INTO v_sub_status FROM public.subscriptions s WHERE s.company_id = v_company_id;
  IF v_sub_status IN ('SUSPENDED', 'EXPIRED', 'CANCELLED') THEN
    RAISE EXCEPTION 'creator_portal_prepare_submission: subscription not active';
  END IF;

  SELECT nullif((coalesce(p.limits, '{}'::jsonb) || coalesce(sub.limit_overrides, '{}'::jsonb)) ->> 'max_pitches', '')::int
    INTO v_max_pitches
    FROM public.subscriptions sub JOIN public.plans p ON p.key = sub.plan_key WHERE sub.company_id = v_company_id;
  IF v_max_pitches IS NOT NULL THEN
    SELECT count(*) INTO v_active_count FROM public.pitches WHERE company_id = v_company_id AND archived_at IS NULL;
    IF v_active_count >= v_max_pitches THEN
      RAISE EXCEPTION 'creator_portal_prepare_submission: plan limit reached';
    END IF;
  END IF;

  SELECT d.id, d.initial_stage_key INTO v_def_id, v_initial
    FROM public.workflow_definitions d WHERE d.company_id = v_company_id AND d.is_active = true LIMIT 1;
  IF v_def_id IS NULL THEN
    RAISE EXCEPTION 'creator_portal_prepare_submission: no active workflow configured';
  END IF;

  INSERT INTO public.pitch_code_counters (company_id, year, last_value) VALUES (v_company_id, v_year, 1)
    ON CONFLICT (company_id, year) DO UPDATE SET last_value = public.pitch_code_counters.last_value + 1
    RETURNING last_value INTO v_last_value;
  SELECT coalesce(c.pitch_code_prefix, c.code) INTO v_prefix FROM public.companies c WHERE c.id = v_company_id;
  v_code := v_prefix || '-' || v_year || '-' || lpad(v_last_value::text, 6, '0');

  RETURN QUERY SELECT v_code, v_def_id, v_initial;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.creator_portal_prepare_submission() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.creator_portal_prepare_submission() TO pitch_creator;
--> statement-breakpoint

-- Plan storage/file-size limits (tenancy/limits.ts assertCanStore), for the creator-portal upload
-- path. Raises on violation; returns nothing on success. Company-wide storage usage (every pitch's
-- documents, not just this creator's own) is exactly the kind of read pitch_creator must not have
-- directly, so it happens here, under definer privilege, same as the pitch-numbering function above.
CREATE FUNCTION public.creator_portal_check_upload_quota(p_size_bytes bigint) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_company_id uuid := public.app_company_id();
  v_creator_id uuid := public.app_creator_id();
  v_sub_status text;
  v_max_file_bytes bigint;
  v_storage_bytes bigint;
  v_used bigint;
BEGIN
  IF v_company_id IS NULL OR v_creator_id IS NULL THEN
    RAISE EXCEPTION 'creator_portal_check_upload_quota: no creator session';
  END IF;

  SELECT s.status INTO v_sub_status FROM public.subscriptions s WHERE s.company_id = v_company_id;
  IF v_sub_status IN ('SUSPENDED', 'EXPIRED', 'CANCELLED') THEN
    RAISE EXCEPTION 'creator_portal_check_upload_quota: subscription not active';
  END IF;

  SELECT nullif((coalesce(p.limits, '{}'::jsonb) || coalesce(sub.limit_overrides, '{}'::jsonb)) ->> 'max_file_bytes', '')::bigint,
         nullif((coalesce(p.limits, '{}'::jsonb) || coalesce(sub.limit_overrides, '{}'::jsonb)) ->> 'storage_bytes', '')::bigint
    INTO v_max_file_bytes, v_storage_bytes
    FROM public.subscriptions sub JOIN public.plans p ON p.key = sub.plan_key WHERE sub.company_id = v_company_id;

  IF v_max_file_bytes IS NOT NULL AND p_size_bytes > v_max_file_bytes THEN
    RAISE EXCEPTION 'creator_portal_check_upload_quota: file too large';
  END IF;

  IF v_storage_bytes IS NOT NULL THEN
    SELECT coalesce(sum(dv.size_bytes), 0) INTO v_used FROM public.document_versions dv WHERE dv.company_id = v_company_id;
    SELECT v_used + coalesce(sum(pi.size_bytes), 0) INTO v_used FROM public.pitch_images pi WHERE pi.company_id = v_company_id;
    IF v_used + p_size_bytes > v_storage_bytes THEN
      RAISE EXCEPTION 'creator_portal_check_upload_quota: storage full';
    END IF;
  END IF;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.creator_portal_check_upload_quota(bigint) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.creator_portal_check_upload_quota(bigint) TO pitch_creator;
--> statement-breakpoint

-- ── 13. Best-effort audit trail for portal actions ──────────────────────────
-- pitch_creator has no grant on audit_logs (it is one of pitch_app's staff-only append-only tables —
-- §1 grants list). Register/login/submit/upload are still worth a staff-visible record (security §11.12:
-- "repeated failed logins", "unusual API activity"), so this narrow SECURITY DEFINER function writes one
-- on the creator's behalf: always actor_id = NULL (it never claims to be a staff user), company_id taken
-- only from the session context (never a parameter, so it cannot write into another company's log), and
-- the creator id recorded inside the JSON payload, not as a first-class actor. It never raises — an audit
-- write must never be the reason a real action (register, submit, upload) fails.
CREATE FUNCTION public.creator_portal_audit(p_action varchar, p_resource_type varchar, p_resource_id uuid, p_after jsonb DEFAULT NULL) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_company_id uuid := public.app_company_id();
  v_creator_id uuid := public.app_creator_id();
BEGIN
  IF v_company_id IS NULL THEN RETURN; END IF;
  INSERT INTO public.audit_logs (company_id, actor_id, action, resource_type, resource_id, after)
  VALUES (v_company_id, NULL, p_action, p_resource_type, p_resource_id, coalesce(p_after, '{}'::jsonb) || jsonb_build_object('creatorId', v_creator_id));
EXCEPTION WHEN OTHERS THEN
  RETURN;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.creator_portal_audit(varchar, varchar, uuid, jsonb) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.creator_portal_audit(varchar, varchar, uuid, jsonb) TO pitch_creator;
--> statement-breakpoint

-- ── 14. CREATOR_DATABASE_URL — documented in .env.example, no value committed ─
-- (Nothing to migrate here; this section exists only so the migration's own comment history
-- records that a fourth connection string, alongside DATABASE_URL/PLATFORM_DATABASE_URL/
-- MIGRATION_DATABASE_URL, was introduced by this migration. See CreatorPool in db/client.ts.)
