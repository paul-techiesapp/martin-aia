-- Recursive unit scoping (2026-08-04 incident fix).
--
-- INCIDENT: unit manager MN9441-NICOLE (and INFINITY J-JO, MT77-WILLIAM) were
-- linked under a parent root in late July. The unit helpers assumed a FLAT
-- one-level unit (root + direct children): get_unit_root() = my parent, and
-- unit_member_ids() = agents hanging directly off that root. The moment a
-- manager with their own team gained a parent, their team members (now
-- grandchildren of the root) fell outside every unit-scoped RLS policy — the
-- portal showed "all team data disappeared". Nothing was deleted.
--
-- FIX: a unit is now the ENTIRE TREE under the top-most root.
--   * get_unit_root()  walks UP to the top-most ancestor (parent IS NULL).
--   * unit_member_ids() walks DOWN the whole subtree of that root.
-- Semantics preserved:
--   * Unit admins (roots) see everything under them — now incl. grandchildren.
--   * Deputy managers (is_unit_manager, no team) still see the whole unit.
--   * Mid-level managers (is_unit_manager WITH a team) regain their team.
--   * Plain agents are unchanged (is_unit_viewer() still gates everything).
--
-- Deliberately NOT changed: get_enquiry_context / unit form settings
-- (20260721000003) still resolve branding to the NEAREST parent, so a
-- sub-unit's public enquiry forms keep the sub-unit's own branding.

-- Top-most ancestor of the CURRENT caller (self when they have no parent).
-- Depth-capped so a hypothetical parent cycle degrades to NULL, not a hang.
CREATE OR REPLACE FUNCTION get_unit_root()
RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH RECURSIVE up AS (
    SELECT a.id, a.parent_agent_id, 0 AS depth
    FROM agents a WHERE a.user_id = auth.uid()
    UNION ALL
    SELECT p.id, p.parent_agent_id, up.depth + 1
    FROM agents p
    JOIN up ON p.id = up.parent_agent_id
    WHERE up.depth < 50
  )
  SELECT id FROM up WHERE parent_agent_id IS NULL LIMIT 1;
$$;

-- Every agent in the caller's unit = the full subtree rooted at get_unit_root(),
-- viewer-gated exactly as before. Depth-capped like get_unit_root().
CREATE OR REPLACE FUNCTION unit_member_ids()
RETURNS SETOF uuid
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH RECURSIVE down AS (
    SELECT a.id, 0 AS depth
    FROM agents a
    WHERE a.id = get_unit_root() AND is_unit_viewer()
    UNION ALL
    SELECT c.id, down.depth + 1
    FROM agents c
    JOIN down ON c.parent_agent_id = down.id
    WHERE down.depth < 50
  )
  SELECT id FROM down;
$$;

-- Round-7 summary RPCs: replace the inline flat COALESCE(parent_agent_id, id)
-- unit-root computation with the same recursive top-root mapping, so summary
-- grouping agrees with what unit_member_ids()/RLS lets each caller see.

CREATE OR REPLACE FUNCTION enquiry_unit_summary(
  p_from date DEFAULT NULL,
  p_to   date DEFAULT NULL
)
RETURNS TABLE (
  unit_name       text,
  unit_root_id    uuid,
  forms_submitted bigint,
  customers       bigint,
  cars            bigint,
  cars_open       bigint,
  cars_renewed    bigint,
  agents_active   bigint
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH RECURSIVE unit_roots AS (
    -- Map every agent to their TOP-MOST root; carry the root's unit_name so a
    -- multi-level unit groups as ONE row under the root's name.
    SELECT r.id, r.id AS root_id, r.unit_name AS root_unit_name
    FROM agents r WHERE r.parent_agent_id IS NULL
    UNION ALL
    SELECT c.id, ur.root_id, ur.root_unit_name
    FROM agents c
    JOIN unit_roots ur ON c.parent_agent_id = ur.id
  ),
  scoped AS (
    SELECT
      e.id,
      e.agent_id,
      enquiry_nric_norm(e.customer_nric) AS nric_norm,
      ur.root_unit_name AS unit_name,
      ur.root_id AS unit_root_id
    FROM enquiries e
    LEFT JOIN unit_roots ur ON ur.id = e.agent_id
    WHERE (p_from IS NULL OR (e.created_at AT TIME ZONE 'Asia/Singapore')::date >= p_from)
      AND (p_to   IS NULL OR (e.created_at AT TIME ZONE 'Asia/Singapore')::date <= p_to)
      AND (
        is_admin()
        OR (is_unit_viewer() AND e.agent_id IN (SELECT unit_member_ids()))
        OR (NOT is_admin() AND NOT is_unit_viewer() AND e.agent_id = get_agent_id())
      )
  )
  SELECT
    COALESCE(s.unit_name, 'House') AS unit_name,
    s.unit_root_id,
    count(DISTINCT s.id) AS forms_submitted,
    -- People with an IC dedupe by IC; IC-less enquiries (the nric_required=false
    -- path) each count as their own customer, since there is nothing to match on.
    count(DISTINCT s.nric_norm) FILTER (WHERE s.nric_norm <> '')
      + count(DISTINCT s.id) FILTER (WHERE s.nric_norm = '') AS customers,
    count(v.id) FILTER (WHERE v.removed_at IS NULL) AS cars,
    count(v.id) FILTER (WHERE v.removed_at IS NULL AND v.status IN ('submitted', 'quoted')) AS cars_open,
    count(v.id) FILTER (WHERE v.removed_at IS NULL AND v.status = 'renewed') AS cars_renewed,
    count(DISTINCT s.agent_id) AS agents_active
  FROM scoped s
  LEFT JOIN enquiry_vehicles v ON v.enquiry_id = s.id
  GROUP BY 1, 2
  ORDER BY 3 DESC;
$$;

CREATE OR REPLACE FUNCTION enquiry_agent_summary(
  p_from      date DEFAULT NULL,
  p_to        date DEFAULT NULL,
  p_unit_root uuid DEFAULT NULL
)
RETURNS TABLE (
  agent_id        uuid,
  agent_name      text,
  agent_code      text,
  unit_name       text,
  forms_submitted bigint,
  customers       bigint,
  cars            bigint,
  cars_open       bigint,
  cars_renewed    bigint
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH RECURSIVE unit_roots AS (
    SELECT r.id, r.id AS root_id
    FROM agents r WHERE r.parent_agent_id IS NULL
    UNION ALL
    SELECT c.id, ur.root_id
    FROM agents c
    JOIN unit_roots ur ON c.parent_agent_id = ur.id
  ),
  scoped AS (
    SELECT
      e.id,
      e.agent_id,
      enquiry_nric_norm(e.customer_nric) AS nric_norm,
      a.name AS agent_name,
      a.agent_code,
      a.unit_name
    FROM enquiries e
    JOIN agents a ON a.id = e.agent_id
    JOIN unit_roots ur ON ur.id = a.id
    WHERE (p_from IS NULL OR (e.created_at AT TIME ZONE 'Asia/Singapore')::date >= p_from)
      AND (p_to   IS NULL OR (e.created_at AT TIME ZONE 'Asia/Singapore')::date <= p_to)
      -- A unit viewer may only ask about their OWN unit: passing another unit's
      -- root returns nothing rather than that unit's data. Root matching is now
      -- recursive, so a mid-level manager's team still matches the TOP root.
      AND (p_unit_root IS NULL OR ur.root_id = p_unit_root)
      AND (
        is_admin()
        OR (is_unit_viewer() AND e.agent_id IN (SELECT unit_member_ids()))
        OR (NOT is_admin() AND NOT is_unit_viewer() AND e.agent_id = get_agent_id())
      )
  )
  SELECT
    s.agent_id,
    s.agent_name,
    s.agent_code,
    s.unit_name,
    count(DISTINCT s.id) AS forms_submitted,
    count(DISTINCT s.nric_norm) FILTER (WHERE s.nric_norm <> '')
      + count(DISTINCT s.id) FILTER (WHERE s.nric_norm = '') AS customers,
    count(v.id) FILTER (WHERE v.removed_at IS NULL) AS cars,
    count(v.id) FILTER (WHERE v.removed_at IS NULL AND v.status IN ('submitted', 'quoted')) AS cars_open,
    count(v.id) FILTER (WHERE v.removed_at IS NULL AND v.status = 'renewed') AS cars_renewed
  FROM scoped s
  LEFT JOIN enquiry_vehicles v ON v.enquiry_id = s.id
  GROUP BY 1, 2, 3, 4
  ORDER BY 5 DESC;
$$;
