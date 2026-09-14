-- Enquiry summary "Renewed" counts must include agent-marked renewals.
--
-- BUG (client report 2026-09-14): units renew many customers through the
-- agent-portal "Mark as renewed" action (mark_vehicle_renewed, 20260721000001),
-- which — by client decision — only stamps marked_renewed_at and rolls the
-- expiry forward; it does NOT set status = 'renewed', because the gold gift
-- stays merchant-confirmed via confirm_vehicle_renewal. The round-7/8 summary
-- RPCs only counted status = 'renewed', so the admin Reports › Enquiries tab
-- (and the agent Team Report) showed every agent-marked renewal as still Open.
--
-- FIX: count a car as Renewed when EITHER the merchant confirmed it
-- (status = 'renewed') OR an agent marked it renewed (marked_renewed_at set);
-- count it as Open only when neither applies. cars = open + renewed + lost
-- still holds, and a car that was agent-marked and later merchant-confirmed is
-- counted once.
--
-- Same signatures / RETURNS TABLE as 20260804000001, so CREATE OR REPLACE
-- keeps the existing grants. Only the two FILTER lines change in each RPC.

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
    count(DISTINCT s.nric_norm) FILTER (WHERE s.nric_norm <> '')
      + count(DISTINCT s.id) FILTER (WHERE s.nric_norm = '') AS customers,
    count(v.id) FILTER (WHERE v.removed_at IS NULL) AS cars,
    count(v.id) FILTER (
      WHERE v.removed_at IS NULL
        AND v.status IN ('submitted', 'quoted')
        AND v.marked_renewed_at IS NULL
    ) AS cars_open,
    count(v.id) FILTER (
      WHERE v.removed_at IS NULL
        AND (v.status = 'renewed' OR v.marked_renewed_at IS NOT NULL)
    ) AS cars_renewed,
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
    count(v.id) FILTER (
      WHERE v.removed_at IS NULL
        AND v.status IN ('submitted', 'quoted')
        AND v.marked_renewed_at IS NULL
    ) AS cars_open,
    count(v.id) FILTER (
      WHERE v.removed_at IS NULL
        AND (v.status = 'renewed' OR v.marked_renewed_at IS NOT NULL)
    ) AS cars_renewed
  FROM scoped s
  LEFT JOIN enquiry_vehicles v ON v.enquiry_id = s.id
  GROUP BY 1, 2, 3, 4
  ORDER BY 5 DESC;
$$;
