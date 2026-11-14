"""Accuracy checks. The build is not trusted until every one passes.

Three kinds of check:
  internal   the federal files agree with themselves (parts add up to totals)
  model      the SQL did what it says (keys, rules, medians recomputed in Python)
  outside    figures agree with a second source, or the match to one is documented

Writes docs/data/checks.js for the methods page and exits non-zero on any failure.
Usage:  python3 pipeline/checks.py
"""
import csv
import datetime
import json
import os
import sqlite3
import statistics
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DB = os.path.join(ROOT, "build", "warehouse.sqlite")
SEEDS = os.path.join(ROOT, "data", "seeds")
OUT = os.path.join(ROOT, "docs", "data", "checks.js")

RESULTS = []


def check(kind, name, passed, detail):
    RESULTS.append({"kind": kind, "name": name, "passed": bool(passed), "detail": detail})
    print("{}  [{}] {}: {}".format("PASS" if passed else "FAIL", kind, name, detail))


def one(conn, sql, args=()):
    return conn.execute(sql, args).fetchone()[0]


def main():
    conn = sqlite3.connect(DB)
    latest = one(conn, "SELECT latest_year FROM config")
    rows_all = one(conn, "SELECT COUNT(*) FROM stg_eada_inst")

    # ---------------- internal consistency ----------------
    thin = conn.execute("SELECT year, COUNT(*) FROM stg_eada_inst GROUP BY year HAVING COUNT(*) < 1900").fetchall()
    years = [r[0] for r in conn.execute("SELECT DISTINCT year FROM stg_eada_inst ORDER BY year")]
    check("internal", "Every year loaded in full", not thin and len(years) >= 3,
          "{} years, {:,} institution records; no year has fewer than 1,900".format(len(years), rows_all))

    dupes = one(conn, "SELECT COUNT(*) FROM (SELECT unitid, year FROM stg_eada_inst GROUP BY 1, 2 HAVING COUNT(*) > 1)")
    check("internal", "One record per institution per year", dupes == 0, "{} duplicate keys".format(dupes))

    bad = one(conn, """
        SELECT COUNT(*) FROM fact_athletics
        WHERE ABS(COALESCE(expense_by_sport, 0) + COALESCE(expense_unallocated, 0) - expense_total) > 2""")
    check("internal", "Sport expenses plus unallocated expenses equal total expense", bad == 0,
          "{:,} of {:,} records differ by more than $2".format(bad, rows_all))

    bad = one(conn, """
        SELECT COUNT(*) FROM fact_athletics f
        JOIN (SELECT unitid, year, SUM(participants) AS p FROM fact_sport GROUP BY 1, 2) s USING (unitid, year)
        WHERE s.p <> f.team_slots""")
    check("internal", "Sport rosters add up to the institution's participant total", bad == 0,
          "{:,} records differ".format(bad))

    bad = one(conn, """
        SELECT COUNT(*) FROM stg_eada_inst
        WHERE ABS(COALESCE(studentaid_men, 0) + COALESCE(studentaid_women, 0) + COALESCE(studentaid_coed, 0)
                  - COALESCE(studentaid_total, 0)) > 2""")
    check("internal", "Aid to men, women, and coed teams equals total athletic aid", bad == 0,
          "{:,} records differ by more than $2".format(bad))

    bad = one(conn, "SELECT COUNT(*) FROM fact_athletics WHERE athletes > team_slots")
    check("internal", "Unduplicated athletes never exceed roster spots", bad == 0,
          "{:,} records where athletes counted once exceed athletes counted per team".format(bad))

    # ---------------- model integrity ----------------
    dupes = one(conn, "SELECT COUNT(*) FROM (SELECT unitid, year FROM mart_school_year GROUP BY 1, 2 HAVING COUNT(*) > 1)")
    n_mart = one(conn, "SELECT COUNT(*) FROM mart_school_year")
    check("model", "School-year mart has one row per key", dupes == 0, "{:,} rows, {} duplicate keys".format(n_mart, dupes))

    bad = one(conn, """
        SELECT COUNT(*) FROM mart_school_year
        WHERE athlete_share < 0 OR women_share_of_athletes < 0 OR women_share_of_athletes > 1
           OR women_share_of_undergrads < 0 OR women_share_of_undergrads > 1
           OR expense_per_athlete < 0 OR (COALESCE(athletes, 0) = 0 AND expense_per_athlete IS NOT NULL)""")
    check("model", "Ratios stay in range and are blank when the denominator is zero", bad == 0,
          "{} out-of-range values".format(bad))

    bad = one(conn, """
        SELECT COUNT(*) FROM mart_school_year m JOIN dim_institution i USING (unitid)
        WHERE i.allows_athletic_aid = 0 AND (m.aid_per_athlete IS NOT NULL OR m.aid_share_of_tuition IS NOT NULL)""")
    reported = one(conn, """
        SELECT COUNT(*) FROM fact_athletics f JOIN dim_institution i USING (unitid)
        WHERE i.allows_athletic_aid = 0 AND f.year = ? AND COALESCE(f.aid_total, 0) > 0""", (latest,))
    check("model", "Division III colleges show no athletic aid measures", bad == 0,
          "0 measures shown; {} Division III records report a nonzero aid figure in the federal file, which the page does not rank".format(reported))

    # Medians recomputed outside SQL, for every division and conference and every measure.
    groups = {}
    for gtype, gname, unitid in conn.execute("SELECT group_type, group_name, unitid FROM bridge_group_member"):
        groups.setdefault((gtype, gname), set()).add(unitid)
    values = {}
    for unitid, year, measure, value in conn.execute("SELECT unitid, year, measure, value FROM measure_long"):
        values.setdefault((year, measure), {})[unitid] = value
    worst, compared = 0.0, 0
    for gtype, gname, year, measure, n, median in conn.execute(
            "SELECT group_type, group_name, year, measure, schools, median FROM mart_group_medians"):
        vals = [v for u, v in values[(year, measure)].items() if u in groups[(gtype, gname)]]
        expect = statistics.median(vals)
        worst = max(worst, abs(expect - median) / (abs(expect) or 1))
        if len(vals) != n:
            worst = 1.0
        compared += 1
    check("model", "SQL medians match medians recomputed in Python", worst < 1e-9,
          "{:,} medians compared; largest relative difference {:.1e}".format(compared, worst))

    bad = one(conn, """
        SELECT COUNT(*) FROM (
          SELECT conference, measure, MAX(value) AS top,
                 MAX(CASE WHEN rank_high_to_low = 1 THEN value END) AS ranked_first
          FROM mart_conference_rank GROUP BY 1, 2) WHERE top <> ranked_first""")
    check("model", "Rank 1 in every conference is the highest value", bad == 0, "{} mismatches".format(bad))

    lagged = one(conn, "SELECT COUNT(*) FROM fact_price WHERE year = ? AND price_lag_years > 0", (latest,))
    priced = one(conn, "SELECT COUNT(*) FROM fact_price WHERE year = ?", (latest,))
    worst_lag = one(conn, "SELECT COALESCE(MAX(price_lag_years), 0) FROM fact_price")
    check("model", "Each price is from the same year or the latest earlier year", worst_lag <= 3,
          "{:,} of {:,} latest-year prices come from an earlier year; the largest gap is {} year(s)".format(lagged, priced, worst_lag))

    # ---------------- conference match ----------------
    members = one(conn, "SELECT COUNT(*) FROM seed_conference_member")
    missing = one(conn, """
        SELECT COUNT(*) FROM seed_conference_member c
        WHERE NOT EXISTS (SELECT 1 FROM stg_eada_inst e WHERE e.unitid = c.unitid AND e.year = ?)""", (latest,))
    twice = one(conn, "SELECT COUNT(*) FROM (SELECT unitid FROM seed_conference_member GROUP BY 1 HAVING COUNT(*) > 1)")
    check("outside", "Every conference member is a real EADA record, in one conference only",
          missing == 0 and twice == 0, "{:,} members; {} not in the federal file; {} in two conferences".format(members, missing, twice))

    with open(os.path.join(SEEDS, "conference_unmatched.csv"), newline="", encoding="utf-8") as fh:
        unmatched = list(csv.DictReader(fh))
    unexplained = [r for r in unmatched if r["reason"].startswith(("ambiguous", "no EADA school", "one EADA record"))]
    check("outside", "Every school left out of a conference has a stated reason", not unexplained,
          "{:,} matched; {} left out with a reason (single-sex colleges, service academies, merged campuses, "
          "no federal aid, Canadian, closed, or not yet moved to a new division); {} unexplained".format(members, len(unmatched), len(unexplained)))

    sizes = conn.execute("SELECT MIN(members_with_data), MAX(members_with_data), COUNT(*) FROM dim_conference").fetchone()
    check("outside", "Conference sizes are plausible", sizes[0] >= 2 and sizes[1] <= 20,
          "{} conferences, from {} to {} members with data".format(sizes[2], sizes[0], sizes[1]))

    # ---------------- second source: IPEDS enrollment ----------------
    year_e = one(conn, "SELECT MAX(year) FROM stg_drvef")
    n, w5, w10 = conn.execute("""
        SELECT COUNT(*), SUM(ABS(1.0 * e.eftotalcount / d.efugft - 1) <= 0.05),
               SUM(ABS(1.0 * e.eftotalcount / d.efugft - 1) <= 0.10)
        FROM stg_eada_inst e JOIN stg_drvef d ON d.unitid = e.unitid AND d.year = e.year
        WHERE e.year = ? AND d.efugft > 0 AND e.eftotalcount > 0""", (year_e,)).fetchone()
    check("outside", "Full-time undergraduate counts agree with IPEDS fall enrollment",
          n > 1900 and w5 / n >= 0.80 and w10 / n >= 0.88,
          "fall {}: {:,} colleges in both sources; {:.0%} within 5% and {:.0%} within 10%. "
          "The two surveys count on different dates and EADA leaves out some students, so exact agreement is not expected".format(
              year_e, n, w5 / n, w10 / n))

    # ---------------- the page bundle ----------------
    path = os.path.join(ROOT, "docs", "data", "explorer.js")
    with open(path, encoding="utf-8") as fh:
        text = fh.read()
    bundle = json.loads(text[text.index("{"):text.rindex("}") + 1])
    in_page = len(bundle["values"][str(latest)])
    in_db = one(conn, "SELECT COUNT(*) FROM mart_school_year WHERE year = ? AND COALESCE(athletes, 0) > 0", (latest,))
    check("model", "The page carries every college with athletes in the latest year", in_page == in_db,
          "{:,} in the page file, {:,} in the database".format(in_page, in_db))

    failed = sum(1 for r in RESULTS if not r["passed"])
    with open(OUT, "w", encoding="utf-8") as fh:
        fh.write("// Generated by pipeline/checks.py. Do not edit by hand.\n")
        fh.write("window.CHECKS = ")
        json.dump({"total": len(RESULTS), "failed": failed, "run_on": datetime.date.today().isoformat(),
                   "items": RESULTS}, fh, separators=(",", ":"))
        fh.write(";\n")
    print("\n{} of {} checks passed".format(len(RESULTS) - failed, len(RESULTS)))
    conn.close()
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
