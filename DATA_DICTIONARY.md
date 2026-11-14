# Data dictionary

Every table states its grain: what one row means. The checks fail the build if a mart has more than one row per grain.

The model has three layers.

| Layer | Prefix | What it holds |
|---|---|---|
| Staging | `stg_`, `seed_` | Federal files as published, limited to the columns named in `pipeline/sources.py`, plus small reference tables |
| Core | `dim_`, `fact_`, `bridge_` | Cleaned, renamed, joined tables for every college in the federal file |
| Marts | `mart_` | Finished tables with every derived measure; exported to `data/marts/` |

Shares are stored as fractions (0.288, not 28.8). Dollar amounts are nominal. `year` is the fall the reporting year starts in: 2024 means 2024-25.

## Core tables

| Table | Grain | Source |
|---|---|---|
| `config` | One row | First and latest EADA year loaded |
| `dim_division` | One row per EADA classification | EADA classification codes, grouped into divisions in `sql/01_core_model.sql` |
| `dim_institution` | One row per college | EADA institution file, latest year; conference and caution from the seed files |
| `dim_conference` | One row per conference | Built from `dim_institution` |
| `bridge_group_member` | One row per group per member college | Division from EADA; conference from the seed file |
| `fact_athletics` | One row per college per year | EADA institution file; teams and sport totals from the sport file; prices from IPEDS |
| `fact_sport` | One row per college, year, and sport family | EADA sport file |
| `fact_price` | One row per college per EADA year | IPEDS Institutional Characteristics, latest price year at or before the EADA year |

## Seed files

| File | Grain | What it is |
|---|---|---|
| `conference_members.csv` | One row per college | Conference for 2024-25, the list it came from, the name on that list, the EADA name, and how the match was made |
| `conference_overrides.csv` | One row per hand decision | A list name mapped to a unit ID, or to nothing, with the reason |
| `conference_unmatched.csv` | One row per school left out | Every listed school with no conference group, and why |
| `institution_flags.csv` | One row per flagged record | Records that combine several athletic programs or need a caution |
| `state_fips.csv` | One row per state | State to Census region |

## mart_school_year

Grain: one row per college per year.

| Column | Definition | EADA or IPEDS field |
|---|---|---|
| `ft_undergrads` | Full-time undergraduates | `EFTotalCount` |
| `athletes` | Athletes counted once each | `UNDUP_CT_PARTIC_MEN` + `UNDUP_CT_PARTIC_WOMEN` |
| `teams` | Men's and women's teams with at least one participant, counted separately | Sport file |
| `aid_total` | Athletically related student aid | `STUDENTAID_TOTAL` |
| `expense_total` | All athletics expenses | `GRND_TOTAL_EXPENSE` |
| `recruiting_expense` | Recruiting expenses | `RECRUITEXP_TOTAL` |
| `tuition_fees` | Published in-state tuition and required fees | IPEDS `CHG2AY3` |
| `price_lag_years` | Years between the EADA year and the price year used | Computed |
| `athlete_share` | `athletes / ft_undergrads` | Computed |
| `athletes_per_team` | `athletes / teams` | Computed |
| `athletes_per_coach` | `athletes /` head and assistant coach full-time equivalents | `FTE_HDCOACH_*`, `FTE_ASCOACH_*` |
| `expense_per_athlete` | `expense_total / athletes` | Computed |
| `nonaid_expense_per_athlete` | `(expense_total - aid_total) / athletes` | Computed |
| `recruiting_per_athlete` | `recruiting_expense / athletes` | Computed |
| `aid_per_athlete` | `aid_total / athletes`; blank for NCAA Division III | Computed |
| `aid_share_of_tuition` | `aid_per_athlete / tuition_fees`; blank for NCAA Division III | Computed |
| `full_ride_equiv_per_100` | `100 * aid_total / cost of attendance / athletes`; blank for NCAA Division III | IPEDS `CHG2AY3` + `CHG4AY3` + `CHG5AY3` + `CHG6AY3` |
| `aid_share_of_expense` | `aid_total / expense_total`; blank for NCAA Division III | Computed |
| `women_share_of_athletes` | Women athletes divided by athletes | `UNDUP_CT_PARTIC_WOMEN` |
| `women_share_of_undergrads` | Women divided by full-time undergraduates | `EFFemaleCount` |
| `proportionality_gap` | `women_share_of_undergrads - women_share_of_athletes` | Computed |
| `women_share_of_aid` | Aid to women's teams divided by total aid; blank for NCAA Division III | `STUDENTAID_WOMEN` |
| `head_coach_salary_fte_men`, `_women` | Average head coach salary per full-time equivalent | `HDCOACH_SAL_FTE_MEN`, `HDCOACH_SAL_FTE_WOMN` |

## mart_sport_school

Grain: one row per college per sport family, latest year. `participants` counts a student once per team. `expense_per_participant` is `expense / participants`. Track and cross country are one family, and swimming and diving are one family.

## mart_group_medians

Grain: one row per group, year, and measure. `group_type` is `division` or `conference`. `schools` is the number of colleges with a value. `median` is the middle value, or the average of the middle two.

## mart_conference_rank

Grain: one row per conference member per measure, latest year. `rank_high_to_low` is 1 for the highest value; ties share a rank.

## mart_schools

Grain: one row per college. The list the page's search box reads, with division, conference, and any caution.

## Rules worth knowing

1. **Comparison group.** A median is only as good as the group behind it. The group and its size are shown beside every median.
2. **Minimum group.** The page shows no median or rank for a group of fewer than three colleges, and no sport median with fewer than three colleges sponsoring the sport.
3. **Blank, never zero.** A ratio with a missing or zero denominator is blank. A college is skipped in that ranking.
4. **Division III and aid.** NCAA Division III colleges may not award athletic scholarships, so aid measures are blank for them even when the federal file holds a figure.
5. **Combined records.** A record that covers several athletic programs is shown with a caution and left out of every group median.
