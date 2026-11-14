-- 01_core_model.sql
-- Turns the staging tables into a small dimensional model:
--   dim_institution   one row per school (latest EADA year)
--   fact_athletics    one row per school per year, base counts and dollars only
--   fact_sport        one row per school, year, and sport family
-- No ratios here. Every derived measure is defined once, in 03_marts.sql.

DROP TABLE IF EXISTS config;
CREATE TABLE config AS
SELECT (SELECT MAX(year) FROM stg_eada_inst) AS latest_year,
       (SELECT MIN(year) FROM stg_eada_inst) AS first_year;

-- ---------------------------------------------------------------------------
-- Division groups. EADA's classification is self-reported each year. Division I
-- is split by football subdivision because the budgets differ by an order of
-- magnitude; the other associations are kept whole.
-- ---------------------------------------------------------------------------
DROP TABLE IF EXISTS dim_division;
CREATE TABLE dim_division AS
SELECT DISTINCT
       classificationcode AS classification_code,
       TRIM(classification_name) AS classification_name,
       CASE
         WHEN classificationcode = 1 THEN 'NCAA Division I FBS'
         WHEN classificationcode = 2 THEN 'NCAA Division I FCS'
         WHEN classificationcode = 3 THEN 'NCAA Division I, no football'
         WHEN classificationcode IN (4, 5) THEN 'NCAA Division II'
         WHEN classificationcode IN (6, 7) THEN 'NCAA Division III'
         WHEN classificationcode IN (9, 10) THEN 'NAIA'
         WHEN classificationcode IN (12, 13, 14) THEN 'NJCAA'
         WHEN classificationcode = 17 THEN 'CCCAA'
         WHEN classificationcode = 19 THEN 'NWAC'
         WHEN classificationcode IN (15, 16) THEN 'NCCAA'
         WHEN classificationcode = 20 THEN 'USCAA'
         ELSE 'Other or independent'
       END AS division_group,
       CASE
         WHEN classificationcode = 1 THEN 1 WHEN classificationcode = 2 THEN 2
         WHEN classificationcode = 3 THEN 3 WHEN classificationcode IN (4, 5) THEN 4
         WHEN classificationcode IN (6, 7) THEN 5 WHEN classificationcode IN (9, 10) THEN 6
         WHEN classificationcode IN (12, 13, 14) THEN 7 WHEN classificationcode = 17 THEN 8
         WHEN classificationcode = 19 THEN 9 WHEN classificationcode IN (15, 16) THEN 10
         WHEN classificationcode = 20 THEN 11 ELSE 12
       END AS division_order,
       -- NCAA Division III does not allow athletic scholarships.
       CASE WHEN classificationcode IN (6, 7) THEN 0 ELSE 1 END AS allows_athletic_aid
FROM stg_eada_inst
WHERE year = (SELECT latest_year FROM config);

DROP TABLE IF EXISTS dim_institution;
CREATE TABLE dim_institution AS
SELECT i.unitid,
       i.institution_name AS name,
       i.city_txt AS city,
       i.state_cd AS state,
       s.region,
       i.classificationcode AS classification_code,
       d.classification_name,
       d.division_group,
       d.division_order,
       d.allows_athletic_aid,
       i.sector_name AS sector,
       CASE WHEN i.sector_cd IN (1, 2, 3) THEN 1 ELSE 0 END AS is_four_year,
       c.conference,
       f.flag,
       f.note AS flag_note,
       -- A record that covers several athletic programs is shown but left out of group statistics.
       CASE WHEN f.flag IN ('combined_record', 'joint_program') THEN 0 ELSE 1 END AS in_group_stats
FROM stg_eada_inst i
JOIN dim_division d ON d.classification_code = i.classificationcode
LEFT JOIN seed_state s ON s.state_abbr = i.state_cd
LEFT JOIN seed_conference_member c ON c.unitid = i.unitid
LEFT JOIN seed_institution_flag f ON f.unitid = i.unitid
WHERE i.year = (SELECT latest_year FROM config);

CREATE UNIQUE INDEX idx_dim_institution ON dim_institution (unitid);

-- ---------------------------------------------------------------------------
-- Sport families. Schools report track and cross country, and swimming and
-- diving, either combined or as separate teams. Folding them into one family
-- lets a school that reports one way be compared with a school that reports
-- the other. A participant is counted once per team, so a runner on cross
-- country and both track teams counts three times within the family.
-- ---------------------------------------------------------------------------
DROP TABLE IF EXISTS fact_sport;
CREATE TABLE fact_sport AS
SELECT unitid,
       year,
       CASE
         WHEN sports IN ('Track and Field and Cross Country (combined)', 'Track and Field (Indoor)',
                         'Track and Field (Outdoor)', 'Cross Country') THEN 'Track and cross country'
         WHEN sports IN ('Swimming and Diving (combined)', 'Swimming', 'Diving') THEN 'Swimming and diving'
         ELSE sports
       END AS sport,
       SUM(COALESCE(sum_partic_men, 0))   AS participants_men,
       SUM(COALESCE(sum_partic_women, 0)) AS participants_women,
       SUM(COALESCE(sum_partic_men, 0) + COALESCE(sum_partic_women, 0)) AS participants,
       SUM(COALESCE(total_expense_all, 0)) AS expense,
       SUM(CASE WHEN COALESCE(sum_partic_men, 0) > 0 THEN 1 ELSE 0 END)
         + SUM(CASE WHEN COALESCE(sum_partic_women, 0) > 0 THEN 1 ELSE 0 END) AS teams
FROM stg_eada_sport
GROUP BY unitid, year, 3;

CREATE INDEX idx_fact_sport ON fact_sport (unitid, year);

-- ---------------------------------------------------------------------------
-- Published price, from IPEDS. EADA and IPEDS release on different calendars,
-- so each EADA year takes the latest price year at or before it, and the gap
-- is kept so the page can say when a price is a year old.
-- ---------------------------------------------------------------------------
DROP TABLE IF EXISTS fact_price;
CREATE TABLE fact_price AS
WITH priced AS (
  SELECT unitid, year AS price_year,
         chg2ay3 AS tuition_fees,
         CASE WHEN chg2ay3 IS NOT NULL AND chg5ay3 IS NOT NULL
              THEN chg2ay3 + COALESCE(chg4ay3, 0) + chg5ay3 + COALESCE(chg6ay3, 0) END AS cost_of_attendance
  FROM stg_ic_ay
  WHERE chg2ay3 IS NOT NULL
),
matched AS (
  SELECT e.unitid, e.year, p.price_year, p.tuition_fees, p.cost_of_attendance,
         ROW_NUMBER() OVER (PARTITION BY e.unitid, e.year ORDER BY p.price_year DESC) AS pick
  FROM stg_eada_inst e
  JOIN priced p ON p.unitid = e.unitid AND p.price_year <= e.year
)
SELECT unitid, year, price_year, year - price_year AS price_lag_years, tuition_fees, cost_of_attendance
FROM matched
WHERE pick = 1;

CREATE UNIQUE INDEX idx_fact_price ON fact_price (unitid, year);

DROP TABLE IF EXISTS fact_athletics;
CREATE TABLE fact_athletics AS
WITH teams AS (
  SELECT unitid, year, SUM(teams) AS teams, SUM(expense) AS sport_expense, SUM(participants) AS team_slots
  FROM fact_sport
  GROUP BY unitid, year
)
SELECT e.unitid,
       e.year,
       e.classificationcode AS classification_code,
       e.eftotalcount  AS ft_undergrads,
       e.efmalecount   AS ft_undergrad_men,
       e.effemalecount AS ft_undergrad_women,
       -- Unduplicated: a student on two teams counts once.
       e.undup_ct_partic_men   AS athletes_men,
       e.undup_ct_partic_women AS athletes_women,
       COALESCE(e.undup_ct_partic_men, 0) + COALESCE(e.undup_ct_partic_women, 0) AS athletes,
       COALESCE(e.il_sum_partic_men, 0) + COALESCE(e.il_sum_partic_women, 0) AS team_slots,
       t.teams,
       e.studentaid_men   AS aid_men,
       e.studentaid_women AS aid_women,
       e.studentaid_total AS aid_total,
       e.recruitexp_total AS recruiting_expense,
       e.grnd_total_expense AS expense_total,
       e.tot_expense_all_notalloc AS expense_unallocated,
       t.sport_expense AS expense_by_sport,
       e.grnd_total_revenue AS revenue_total,
       COALESCE(e.fte_hdcoach_men, 0) + COALESCE(e.fte_hdcoach_women, 0) + COALESCE(e.fte_hdcoach_coed, 0)
         + COALESCE(e.fte_ascoach_men, 0) + COALESCE(e.fte_ascoach_women, 0) + COALESCE(e.fte_ascoach_coed, 0) AS coach_fte,
       e.hdcoach_sal_fte_men  AS head_coach_salary_fte_men,
       e.hdcoach_sal_fte_womn AS head_coach_salary_fte_women,
       p.tuition_fees,
       p.cost_of_attendance,
       p.price_year,
       p.price_lag_years
FROM stg_eada_inst e
LEFT JOIN teams t ON t.unitid = e.unitid AND t.year = e.year
LEFT JOIN fact_price p ON p.unitid = e.unitid AND p.year = e.year;

CREATE UNIQUE INDEX idx_fact_athletics ON fact_athletics (unitid, year);
