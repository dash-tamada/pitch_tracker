-- Integrity layer: rules that must hold even if the application server is compromised.
-- 1) Append-only tables reject UPDATE/DELETE via triggers.
-- 2) The runtime role `pitch_app` gets the minimum grants (no DDL, no DELETE on business data,
--    INSERT/SELECT only on history tables).
-- The role must exist before migrating (see README → Database roles).

-- Circular FK: documents.current_version_id → document_versions.id
ALTER TABLE "documents"
  ADD CONSTRAINT "documents_current_version_fk"
  FOREIGN KEY ("current_version_id") REFERENCES "document_versions"("id") DEFERRABLE INITIALLY DEFERRED;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION forbid_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'IMMUTABLE_RECORD: % on % is not permitted', TG_OP, TG_TABLE_NAME
    USING ERRCODE = 'insufficient_privilege';
END;
$$;
--> statement-breakpoint

CREATE TRIGGER workflow_events_immutable BEFORE UPDATE OR DELETE ON "workflow_events"
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
--> statement-breakpoint
CREATE TRIGGER platform_responses_immutable BEFORE UPDATE OR DELETE ON "platform_responses"
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
--> statement-breakpoint
CREATE TRIGGER ratings_immutable BEFORE UPDATE OR DELETE ON "ratings"
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
--> statement-breakpoint
CREATE TRIGGER rating_scores_immutable BEFORE UPDATE OR DELETE ON "rating_scores"
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
--> statement-breakpoint
CREATE TRIGGER audit_logs_immutable BEFORE UPDATE OR DELETE ON "audit_logs"
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
--> statement-breakpoint
CREATE TRIGGER document_access_logs_immutable BEFORE UPDATE OR DELETE ON "document_access_logs"
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
--> statement-breakpoint
CREATE TRIGGER document_scan_results_immutable BEFORE UPDATE OR DELETE ON "document_scan_results"
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
--> statement-breakpoint
CREATE TRIGGER development_updates_immutable BEFORE UPDATE OR DELETE ON "development_updates"
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
--> statement-breakpoint
CREATE TRIGGER production_updates_immutable BEFORE UPDATE OR DELETE ON "production_updates"
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
--> statement-breakpoint

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
--> statement-breakpoint
CREATE TRIGGER document_versions_guard BEFORE UPDATE OR DELETE ON "document_versions"
  FOR EACH ROW EXECUTE FUNCTION document_versions_guard();
--> statement-breakpoint

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
--> statement-breakpoint
CREATE TRIGGER workflow_stages_guard BEFORE UPDATE OR DELETE ON "workflow_stages"
  FOR EACH ROW EXECUTE FUNCTION workflow_config_guard();
--> statement-breakpoint
CREATE TRIGGER workflow_transitions_guard BEFORE UPDATE OR DELETE ON "workflow_transitions"
  FOR EACH ROW EXECUTE FUNCTION workflow_config_guard();
--> statement-breakpoint

-- Pitch rows are never hard-deleted (business rule 17).
CREATE TRIGGER pitches_no_delete BEFORE DELETE ON "pitches"
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
--> statement-breakpoint

-- Keep updated_at honest regardless of what the application sends.
CREATE OR REPLACE FUNCTION touch_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;
--> statement-breakpoint
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
--> statement-breakpoint

-- ───────────── Least-privilege grants for the runtime role ─────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pitch_app') THEN
    RAISE EXCEPTION 'Role pitch_app must exist before running migrations (see README)';
  END IF;
END $$;
--> statement-breakpoint
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC;
--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO pitch_app;
--> statement-breakpoint
-- Mutable business tables: read/insert/update, no delete.
GRANT SELECT, INSERT, UPDATE ON
  users, roles, lookup_values, rating_categories, system_settings,
  workflow_definitions, workflow_stages, workflow_transitions,
  creators, creator_projects, pitches, documents, pitch_images,
  platforms, platform_contacts, platform_pitches, follow_ups,
  development_projects, production_projects, notifications, job_outbox,
  pitch_code_counters, password_reset_tokens, sessions, document_versions
TO pitch_app;
--> statement-breakpoint
-- Append-only history tables: read + insert only.
GRANT SELECT, INSERT ON
  workflow_events, platform_responses, ratings, rating_scores, audit_logs,
  document_access_logs, document_scan_results, development_updates, production_updates,
  login_attempts, permissions
TO pitch_app;
--> statement-breakpoint
-- Link tables where removing a row is a legitimate, audited business action.
GRANT SELECT, INSERT, DELETE ON user_roles, role_permissions, saved_filters, pitch_participants TO pitch_app;
--> statement-breakpoint
-- Sessions and login attempts may be purged by retention jobs.
GRANT DELETE ON sessions, login_attempts, password_reset_tokens TO pitch_app;
