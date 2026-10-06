-- Anyone with platform.pitch can record a pitch to a platform from any open stage.
--
-- Before this, a story had to clear Senior Review into "Approved for Platform" first, and only the
-- person currently holding it could record the platform pitch. The default workflow
-- (src/server/config/default-workflow.ts) now adds RECORD_PLATFORM_PITCH from SUBMITTED and the three
-- review levels and no longer requires the current owner for it. This migrates every existing company.
--
-- Like 0009, a workflow definition in use is immutable (workflow_config_guard), so this PUBLISHES A NEW
-- VERSION of each active definition, copies everything across, applies the change, then moves the
-- company's pitches onto it. Old versions are left untouched as history.

-- ── 1. New version of every active definition that does not yet allow an early platform pitch ──
CREATE TEMP TABLE _wf_open ON COMMIT DROP AS
SELECT d.id AS old_id, gen_random_uuid() AS new_id, d.company_id, d.name,
       d.initial_stage_key, d.created_by_id,
       (SELECT max(version) + 1 FROM workflow_definitions x
         WHERE x.company_id = d.company_id AND x.name = d.name) AS new_version
  FROM workflow_definitions d
 WHERE d.is_active
   AND NOT EXISTS (SELECT 1 FROM workflow_transitions t
                    WHERE t.definition_id = d.id AND t.from_stage_key = 'SUBMITTED' AND t.action = 'RECORD_PLATFORM_PITCH');
--> statement-breakpoint

-- Only one definition per company may be active, so the outgoing version is retired first.
UPDATE workflow_definitions d SET is_active = false
  FROM _wf_open u WHERE d.id = u.old_id;
--> statement-breakpoint

INSERT INTO workflow_definitions (id, company_id, name, version, is_active, initial_stage_key, created_by_id)
SELECT new_id, company_id, name, new_version, true, initial_stage_key, created_by_id FROM _wf_open;
--> statement-breakpoint

-- ── 2. Copy the stages unchanged ────────────────────────────────────────────
INSERT INTO workflow_stages (company_id, definition_id, key, name, category, badge, is_terminal, requires_owner, sort_order)
SELECT s.company_id, u.new_id, s.key, s.name, s.category, s.badge, s.is_terminal, s.requires_owner, s.sort_order
  FROM workflow_stages s JOIN _wf_open u ON u.old_id = s.definition_id;
--> statement-breakpoint

-- ── 3. Copy the transitions; recording a platform pitch no longer needs the current owner ──
INSERT INTO workflow_transitions (
  company_id, definition_id, from_stage_key, to_stage_key, action, required_permission,
  allowed_role_keys, requires_current_owner, requires_remarks, requires_rejection_reason,
  requires_recipient, recipient_role_keys, requires_change_types, requires_platform, is_approval)
SELECT t.company_id, u.new_id, t.from_stage_key, t.to_stage_key, t.action, t.required_permission,
       t.allowed_role_keys,
       CASE WHEN t.action = 'RECORD_PLATFORM_PITCH' THEN false ELSE t.requires_current_owner END,
       t.requires_remarks, t.requires_rejection_reason,
       t.requires_recipient, t.recipient_role_keys, t.requires_change_types, t.requires_platform, t.is_approval
  FROM workflow_transitions t JOIN _wf_open u ON u.old_id = t.definition_id;
--> statement-breakpoint

-- ── 4. Add RECORD_PLATFORM_PITCH from the early stages (anyone with platform.pitch) ──
INSERT INTO workflow_transitions (
  company_id, definition_id, from_stage_key, to_stage_key, action, required_permission,
  requires_current_owner, requires_platform)
SELECT u.company_id, u.new_id, st.key, 'PLATFORM_PITCHING', 'RECORD_PLATFORM_PITCH', 'platform.pitch', false, true
  FROM _wf_open u
  JOIN workflow_stages st ON st.definition_id = u.new_id
 WHERE st.key IN ('SUBMITTED', 'INITIAL_REVIEW', 'INTERNAL_REVIEW', 'SENIOR_REVIEW')
   AND EXISTS (SELECT 1 FROM workflow_stages p WHERE p.definition_id = u.new_id AND p.key = 'PLATFORM_PITCHING')
   AND NOT EXISTS (SELECT 1 FROM workflow_transitions t
                    WHERE t.definition_id = u.new_id AND t.from_stage_key = st.key AND t.action = 'RECORD_PLATFORM_PITCH');
--> statement-breakpoint

-- ── 5. Move the pitches onto the new version ────────────────────────────────
UPDATE pitches p SET workflow_definition_id = u.new_id
  FROM _wf_open u WHERE p.workflow_definition_id = u.old_id;
