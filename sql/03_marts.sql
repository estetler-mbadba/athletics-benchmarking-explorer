-- 03_marts.sql
-- Every measure on the page is defined here, once.
--   mart_school_year        one row per school per year, base counts and derived measures
--   mart_sport_school       one row per school and sport family, latest year
--   mart_group_medians      median of each measure for each division and conference, each year
--   mart_conference_rank    each school's rank within its conference, latest year
--   mart_schools            the school list the page's picker reads

-- ---------------------------------------------------------------------------
-- Measures. A ratio is NULL when its denominator is zero or missing, so a
-- school is skipped in that measure's ranking instead of scoring zero.
-- ---------------------------------------------------------------------------
DROP TABLE IF EXISTS mart_school_year;
CREATE TABLE mart_school_year AS
WITH base AS (
  SELECT f.*,
         NULLIF(f.athletes, 0)      AS a,     -- denominators
         NULLIF(f.ft_undergrads, 0) AS ug,
         d.allows_athletic_aid
  FROM fact_athletics f
  JOIN dim_division d ON d.classification_code = (
       SELECT classification_code FROM dim_institution i WHERE i.unitid = f.unitid)
  WHERE f.unitid IN (SELECT unitid FROM dim_institution)
)
SELECT unitid,
       year,
       ft_undergrads,
       athletes,
       teams,
       aid_total,
       expense_total,
       recruiting_expense,
       tuition_fees,
       price_lag_years,
       -- Participation
       1.0 * athletes / ug                                   AS athlete_share,
       1.0 * athletes / NULLIF(teams, 0)                     AS athletes_per_team,
       1.0 * athletes / NULLIF(coach_fte, 0)                 AS athletes_per_coach,
       -- Spending
       1.0 * expense_total / a                               AS expense_per_athlete,
       1.0 * (expense_total - COALESCE(aid_total, 0)) / a    AS nonaid_expense_per_athlete,
       1.0 * recruiting_expense / a                          AS recruiting_per_athlete,
       -- Athletic aid. Division III schools may not award it, so the measures are NULL there.
       CASE WHEN allows_athletic_aid = 1 THEN 1.0 * aid_total / a END AS aid_per_athlete,
       CASE WHEN allows_athletic_aid = 1
            THEN 1.0 * aid_total / a / NULLIF(tuition_fees, 0) END    AS aid_share_of_tuition,
       -- Full cost-of-attendance equivalents: how many full rides the aid budget would
       -- fund, per 100 athletes.
       CASE WHEN allows_athletic_aid = 1
            THEN 100.0 * aid_total / NULLIF(cost_of_attendance, 0) / a END AS full_ride_equiv_per_100,
       CASE WHEN allows_athletic_aid = 1
            THEN 1.0 * aid_total / NULLIF(expense_total, 0) END       AS aid_share_of_expense,
       -- Gender. The gap is in share points: women's share of undergraduates minus
       -- women's share of athletes. Positive means women are under-represented.
       1.0 * athletes_women / a                              AS women_share_of_athletes,
       1.0 * ft_undergrad_women / ug                         AS women_share_of_undergrads,
       1.0 * ft_undergrad_women / ug - 1.0 * athletes_women / a AS proportionality_gap,
       CASE WHEN allows_athletic_aid = 1
            THEN 1.0 * aid_women / NULLIF(aid_total, 0) END  AS women_share_of_aid,
       -- Coaching
       head_coach_salary_fte_men,
       head_coach_salary_fte_women
FROM base;

CREATE UNIQUE INDEX idx_mart_school_year ON mart_school_year (unitid, year);

DROP TABLE IF EXISTS mart_sport_school;
CREATE TABLE mart_sport_school AS
SELECT s.unitid,
       s.sport,
       s.participants,
       s.teams,
       s.expense,
       1.0 * s.expense / NULLIF(s.participants, 0) AS expense_per_participant
FROM fact_sport s
WHERE s.year = (SELECT latest_year FROM config)
  AND s.participants > 0
  AND s.unitid IN (SELECT unitid FROM dim_institution);

-- ---------------------------------------------------------------------------
-- Medians. SQLite has no MEDIAN(), so the measures are unpivoted to one row per
-- value, numbered within each group, and the middle one or two rows averaged.
-- ---------------------------------------------------------------------------
DROP TABLE IF EXISTS measure_long;
CREATE TABLE measure_long AS
SELECT unitid, year, 'ft_undergrads' AS measure, 1.0 * ft_undergrads AS value FROM mart_school_year
UNION ALL SELECT unitid, year, 'athletes', 1.0 * athletes FROM mart_school_year
UNION ALL SELECT unitid, year, 'teams', 1.0 * teams FROM mart_school_year
UNION ALL SELECT unitid, year, 'expense_total', 1.0 * expense_total FROM mart_school_year
UNION ALL SELECT unitid, year, 'athlete_share', athlete_share FROM mart_school_year
UNION ALL SELECT unitid, year, 'athletes_per_team', athletes_per_team FROM mart_school_year
UNION ALL SELECT unitid, year, 'athletes_per_coach', athletes_per_coach FROM mart_school_year
UNION ALL SELECT unitid, year, 'expense_per_athlete', expense_per_athlete FROM mart_school_year
UNION ALL SELECT unitid, year, 'nonaid_expense_per_athlete', nonaid_expense_per_athlete FROM mart_school_year
UNION ALL SELECT unitid, year, 'recruiting_per_athlete', recruiting_per_athlete FROM mart_school_year
UNION ALL SELECT unitid, year, 'aid_per_athlete', aid_per_athlete FROM mart_school_year
UNION ALL SELECT unitid, year, 'aid_share_of_tuition', aid_share_of_tuition FROM mart_school_year
UNION ALL SELECT unitid, year, 'full_ride_equiv_per_100', full_ride_equiv_per_100 FROM mart_school_year
UNION ALL SELECT unitid, year, 'aid_share_of_expense', aid_share_of_expense FROM mart_school_year
UNION ALL SELECT unitid, year, 'women_share_of_athletes', women_share_of_athletes FROM mart_school_year
UNION ALL SELECT unitid, year, 'proportionality_gap', proportionality_gap FROM mart_school_year
UNION ALL SELECT unitid, year, 'head_coach_salary_fte_men', 1.0 * head_coach_salary_fte_men FROM mart_school_year
UNION ALL SELECT unitid, year, 'head_coach_salary_fte_women', 1.0 * head_coach_salary_fte_women FROM mart_school_year;

DELETE FROM measure_long WHERE value IS NULL;
-- A school with no athletes reported is not part of any comparison.
DELETE FROM measure_long
WHERE EXISTS (SELECT 1 FROM mart_school_year m
              WHERE m.unitid = measure_long.unitid AND m.year = measure_long.year
                AND COALESCE(m.athletes, 0) = 0);

CREATE INDEX idx_measure_long ON measure_long (measure, year, unitid);

DROP TABLE IF EXISTS mart_group_medians;
CREATE TABLE mart_group_medians AS
WITH ranked AS (
  SELECT g.group_type, g.group_name, l.year, l.measure, l.value,
         ROW_NUMBER() OVER (PARTITION BY g.group_type, g.group_name, l.year, l.measure ORDER BY l.value) AS rn,
         COUNT(*)     OVER (PARTITION BY g.group_type, g.group_name, l.year, l.measure) AS n
  FROM bridge_group_member g
  JOIN measure_long l ON l.unitid = g.unitid
)
SELECT group_type, group_name, year, measure,
       MAX(n) AS schools,
       AVG(value) AS median
FROM ranked
WHERE rn IN ((n + 1) / 2, (n + 2) / 2)
GROUP BY group_type, group_name, year, measure;

-- ---------------------------------------------------------------------------
-- Rank within the conference, latest year. Rank 1 is the highest value.
-- ---------------------------------------------------------------------------
DROP TABLE IF EXISTS mart_conference_rank;
CREATE TABLE mart_conference_rank AS
SELECT g.group_name AS conference,
       l.unitid,
       l.measure,
       l.value,
       RANK() OVER (PARTITION BY g.group_name, l.measure ORDER BY l.value DESC) AS rank_high_to_low,
       COUNT(*) OVER (PARTITION BY g.group_name, l.measure) AS schools_ranked
FROM bridge_group_member g
JOIN measure_long l ON l.unitid = g.unitid
WHERE g.group_type = 'conference'
  AND l.year = (SELECT latest_year FROM config);

DROP TABLE IF EXISTS mart_schools;
CREATE TABLE mart_schools AS
SELECT i.unitid, i.name, i.city, i.state, i.region, i.classification_name, i.division_group,
       i.division_order, i.allows_athletic_aid, i.is_four_year, i.conference, i.flag, i.flag_note,
       i.in_group_stats
FROM dim_institution i
ORDER BY i.name;
