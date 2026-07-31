-- Round 7: per-unit and per-agent enquiry summaries.
--
-- One SQL source of truth for both portals. The reported defect was that admin,
-- unit and agent views disagreed; having each client aggregate its own copy of
-- the rows is what let them drift, so both surfaces read these functions instead.
--
-- SECURITY DEFINER + the same helpers the RLS policies use, so "my unit" here
-- cannot diverge from what RLS enforces elsewhere.

-- Normalised IC: dedupes the same person across dash/space formatting variants,
-- the same normalisation reassign_customer_agent uses.
CREATE OR REPLACE FUNCTION enquiry_nric_norm(p_nric text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT upper(regexp_replace(coalesce(p_nric, ''), '[^a-zA-Z0-9]', '', 'g'));
$$;

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
  WITH scoped AS (
    SELECT
      e.id,
      e.agent_id,
      enquiry_nric_norm(e.customer_nric) AS nric_norm,
      a.unit_name,
      COALESCE(a.parent_agent_id, a.id) AS unit_root_id
    FROM enquiries e
    LEFT JOIN agents a ON a.id = e.agent_id
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
  WITH scoped AS (
    SELECT
      e.id,
      e.agent_id,
      enquiry_nric_norm(e.customer_nric) AS nric_norm,
      a.name AS agent_name,
      a.agent_code,
      a.unit_name
    FROM enquiries e
    JOIN agents a ON a.id = e.agent_id
    WHERE (p_from IS NULL OR (e.created_at AT TIME ZONE 'Asia/Singapore')::date >= p_from)
      AND (p_to   IS NULL OR (e.created_at AT TIME ZONE 'Asia/Singapore')::date <= p_to)
      -- A unit viewer may only ask about their OWN unit: passing another unit's
      -- root returns nothing rather than that unit's data.
      AND (p_unit_root IS NULL OR COALESCE(a.parent_agent_id, a.id) = p_unit_root)
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

REVOKE ALL ON FUNCTION enquiry_unit_summary(date, date) FROM public, anon;
REVOKE ALL ON FUNCTION enquiry_agent_summary(date, date, uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION enquiry_unit_summary(date, date) TO authenticated;
GRANT EXECUTE ON FUNCTION enquiry_agent_summary(date, date, uuid) TO authenticated;
