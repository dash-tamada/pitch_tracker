-- Remove the CEO / COO Review stage from the story pipeline.
--
-- The workflow is seeded into each company's own rows at provisioning, so changing
-- src/server/config/default-workflow.ts only affects companies created from now on.
-- This migrates every company that already exists.
--
-- A workflow definition that pitches are using is immutable (workflow_config_guard
-- raises WORKFLOW_IN_USE on UPDATE/DELETE of its stages or transitions), so this
-- does what the design intends: it PUBLISHES A NEW VERSION of each active
-- definition, copies everything across except the executive stage, then moves the
-- company's pitches onto it. Old versions are left untouched as history.
--
-- After this, Senior Review is the last review level: ACCEPT (or SEND_TO_PLATFORM)
-- clears a story straight to "Approved for Platform Pitching". The CEO/COO
-- greenlight from Development into Production is untouched.

-- ── 1. New version of every active definition that still has the stage ──────
CREATE TEMP TABLE _wf_upgrade ON COMMIT DROP AS
SELECT d.id AS old_id, gen_random_uuid() AS new_id, d.company_id, d.name,
       d.initial_stage_key, d.created_by_id,
       (SELECT max(version) + 1 FROM workflow_definitions x
         WHERE x.company_id = d.company_id AND x.name = d.name) AS new_version
  FROM workflow_definitions d
 WHERE d.is_active
   AND EXISTS (SELECT 1 FROM workflow_stages s
                WHERE s.definition_id = d.id AND s.key = 'EXECUTIVE_REVIEW');
--> statement-breakpoint

-- Only one definition per company may be active (workflow_def_company_one_active_uq),
-- so the outgoing version is retired before the new one is inserted.
UPDATE workflow_definitions d SET is_active = false
  FROM _wf_upgrade u WHERE d.id = u.old_id;
--> statement-breakpoint

INSERT INTO workflow_definitions (id, company_id, name, version, is_active, initial_stage_key, created_by_id)
SELECT new_id, company_id, name, new_version, true, initial_stage_key, created_by_id FROM _wf_upgrade;
--> statement-breakpoint

-- ── 2. Copy the stages, minus the executive one ─────────────────────────────
INSERT INTO workflow_stages (company_id, definition_id, key, name, category, badge, is_terminal, requires_owner, sort_order)
SELECT s.company_id, u.new_id, s.key, s.name, s.category, s.badge, s.is_terminal, s.requires_owner, s.sort_order
  FROM workflow_stages s JOIN _wf_upgrade u ON u.old_id = s.definition_id
 WHERE s.key <> 'EXECUTIVE_REVIEW';
--> statement-breakpoint

-- ── 3. Copy the transitions, dropping every one that touches the stage ──────
-- Senior Review's ACCEPT is re-pointed as it is copied, so any per-company edits
-- to its other columns (remarks, recipient rules) are carried over.
INSERT INTO workflow_transitions (
  company_id, definition_id, from_stage_key, to_stage_key, action, required_permission,
  allowed_role_keys, requires_current_owner, requires_remarks, requires_rejection_reason,
  requires_recipient, recipient_role_keys, requires_change_types, requires_platform, is_approval)
SELECT t.company_id, u.new_id, t.from_stage_key,
       CASE WHEN t.from_stage_key = 'SENIOR_REVIEW' AND t.action = 'ACCEPT'
            THEN 'APPROVED_FOR_PLATFORM' ELSE t.to_stage_key END,
       t.action, t.required_permission,
       CASE WHEN t.from_stage_key = 'SENIOR_REVIEW' AND t.action = 'ACCEPT'
            THEN ARRAY['SENIOR_EMPLOYEE', 'CEO', 'COO', 'COMPANY_ADMIN'] ELSE t.allowed_role_keys END,
       t.requires_current_owner, t.requires_remarks, t.requires_rejection_reason,
       t.requires_recipient,
       CASE WHEN t.from_stage_key = 'SENIOR_REVIEW' AND t.action = 'ACCEPT'
            THEN NULL ELSE t.recipient_role_keys END,
       t.requires_change_types, t.requires_platform,
       CASE WHEN t.from_stage_key = 'SENIOR_REVIEW' AND t.action = 'ACCEPT'
            THEN true ELSE t.is_approval END
  FROM workflow_transitions t JOIN _wf_upgrade u ON u.old_id = t.definition_id
 WHERE t.from_stage_key <> 'EXECUTIVE_REVIEW'
   AND (t.to_stage_key IS NULL OR t.to_stage_key <> 'EXECUTIVE_REVIEW'
        -- Senior Review ACCEPT pointed AT the executive stage; it is re-pointed by the CASE
        -- above rather than dropped, otherwise the review ladder loses its last step.
        OR (t.from_stage_key = 'SENIOR_REVIEW' AND t.action = 'ACCEPT'));
--> statement-breakpoint

-- The explicit "send to platform" action, previously only available from executive review.
INSERT INTO workflow_transitions (
  company_id, definition_id, from_stage_key, to_stage_key, action, required_permission,
  allowed_role_keys, requires_current_owner, requires_remarks, requires_recipient, is_approval)
SELECT u.company_id, u.new_id, 'SENIOR_REVIEW', 'APPROVED_FOR_PLATFORM', 'SEND_TO_PLATFORM', 'pitch.send_to_platform',
       ARRAY['SENIOR_EMPLOYEE', 'CEO', 'COO', 'COMPANY_ADMIN'], false, true, true, true
  FROM _wf_upgrade u
 WHERE NOT EXISTS (
   SELECT 1 FROM workflow_transitions t
    WHERE t.definition_id = u.new_id AND t.from_stage_key = 'SENIOR_REVIEW' AND t.action = 'SEND_TO_PLATFORM');
--> statement-breakpoint

-- ── 4. Move the pitches onto the new version ───────────────────────────────
UPDATE pitches p SET workflow_definition_id = u.new_id
  FROM _wf_upgrade u WHERE p.workflow_definition_id = u.old_id;
--> statement-breakpoint

-- ── 5. Nothing may point at a stage that no longer exists ───────────────────
-- A pitch parked at executive review had already cleared Senior Review to get
-- there, so advancing is the safe direction: nothing is rejected or sent back.
UPDATE pitches
   SET current_stage_key = 'APPROVED_FOR_PLATFORM', stage_entered_at = now()
 WHERE current_stage_key = 'EXECUTIVE_REVIEW';
--> statement-breakpoint

-- A pitch held or sent back for changes *from* executive review must resume somewhere real.
UPDATE pitches SET paused_from_stage_key = 'SENIOR_REVIEW'
 WHERE paused_from_stage_key = 'EXECUTIVE_REVIEW';
