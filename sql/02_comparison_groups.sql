-- 02_comparison_groups.sql
-- The two comparison groups the database builds for every school:
--   its division (EADA's own classification), and
--   its conference (matched from outside EADA; see pipeline/conference_seed.py).
-- The web page adds three more on request (division within a region, the nearest
-- schools by enrollment, and a hand-picked list) from the same school-level mart.

DROP TABLE IF EXISTS dim_conference;
CREATE TABLE dim_conference AS
SELECT i.conference,
       MIN(i.division_group) AS division_group,   -- the conference's majority division is set below
       COUNT(*) AS members_with_data,
       SUM(i.in_group_stats) AS members_in_stats
FROM dim_institution i
WHERE i.conference IS NOT NULL AND i.conference <> 'Independent'
GROUP BY i.conference;

-- A conference can hold a school that EADA files under another division
-- (a school in transition). Label the conference with its most common division.
UPDATE dim_conference
SET division_group = (
  SELECT division_group FROM (
    SELECT i.division_group, COUNT(*) AS n
    FROM dim_institution i
    WHERE i.conference = dim_conference.conference
    GROUP BY i.division_group
    ORDER BY n DESC, i.division_group
    LIMIT 1));

DROP TABLE IF EXISTS bridge_group_member;
CREATE TABLE bridge_group_member AS
SELECT 'division' AS group_type, division_group AS group_name, unitid
FROM dim_institution
WHERE in_group_stats = 1
UNION ALL
SELECT 'conference', conference, unitid
FROM dim_institution
WHERE in_group_stats = 1 AND conference IS NOT NULL AND conference <> 'Independent';

CREATE INDEX idx_bridge_group ON bridge_group_member (group_type, group_name);
