"""Run every SQL file in sql/ in order, then export the marts.

Outputs
  data/marts/<mart>.csv     one tidy CSV per mart (ready for Tableau, Power BI, or Excel)
  docs/data/explorer.js     the same figures, packed for the web page

Usage:  python3 pipeline/build.py
"""
import csv
import datetime
import glob
import json
import os
import sqlite3

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DB = os.path.join(ROOT, "build", "warehouse.sqlite")
MARTS = os.path.join(ROOT, "data", "marts")
SITE_DATA = os.path.join(ROOT, "docs", "data")

# Measures the page reads, in a fixed order, with the precision each is stored at.
PAGE_MEASURES = [
    ("ft_undergrads", 0), ("athletes", 0), ("teams", 0), ("expense_total", 0), ("aid_total", 0),
    ("recruiting_expense", 0), ("tuition_fees", 0),
    ("athlete_share", 4), ("athletes_per_team", 1), ("athletes_per_coach", 1),
    ("expense_per_athlete", 0), ("nonaid_expense_per_athlete", 0), ("recruiting_per_athlete", 0),
    ("aid_per_athlete", 0), ("aid_share_of_tuition", 4), ("full_ride_equiv_per_100", 1),
    ("aid_share_of_expense", 4), ("women_share_of_athletes", 4), ("women_share_of_undergrads", 4),
    ("proportionality_gap", 4), ("women_share_of_aid", 4),
    ("head_coach_salary_fte_men", 0), ("head_coach_salary_fte_women", 0), ("price_lag_years", 0),
]
SCHOOL_COLUMNS = ["unitid", "name", "city", "state", "region", "division_group", "classification_name",
                  "allows_athletic_aid", "is_four_year", "conference", "flag_note", "in_group_stats"]


def run_sql(conn):
    for path in sorted(glob.glob(os.path.join(ROOT, "sql", "*.sql"))):
        with open(path, encoding="utf-8") as handle:
            conn.executescript(handle.read())
        print("  ran", os.path.relpath(path, ROOT))


def export_csv(conn):
    os.makedirs(MARTS, exist_ok=True)
    names = [r[0] for r in conn.execute(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'mart_%' ORDER BY name")]
    for name in names:
        cur = conn.execute("SELECT * FROM {}".format(name))
        header = [d[0] for d in cur.description]
        rows = cur.fetchall()
        with open(os.path.join(MARTS, name + ".csv"), "w", newline="", encoding="utf-8") as handle:
            writer = csv.writer(handle)
            writer.writerow(header)
            writer.writerows(rows)
        print("  exported {:<24} {:>7,} rows".format(name, len(rows)))


def rounded(value, places):
    if value is None:
        return None
    value = round(value, places)
    return int(value) if places == 0 else value


def export_page(conn):
    os.makedirs(SITE_DATA, exist_ok=True)
    latest, first = conn.execute("SELECT latest_year, first_year FROM config").fetchone()
    years = [r[0] for r in conn.execute("SELECT DISTINCT year FROM mart_school_year ORDER BY year")]

    schools = [list(r) for r in conn.execute(
        "SELECT {} FROM mart_schools ORDER BY name".format(", ".join(SCHOOL_COLUMNS)))]

    cols = ", ".join(m for m, _ in PAGE_MEASURES)
    values = {}
    for year in years:
        block = {}
        for row in conn.execute(
                "SELECT unitid, {} FROM mart_school_year WHERE year = ? AND COALESCE(athletes, 0) > 0".format(cols),
                (year,)):
            block[row[0]] = [rounded(v, p) for v, (_m, p) in zip(row[1:], PAGE_MEASURES)]
        values[year] = block

    sport_names = [r[0] for r in conn.execute(
        "SELECT sport FROM mart_sport_school GROUP BY sport ORDER BY COUNT(*) DESC")]
    sport_index = {name: i for i, name in enumerate(sport_names)}
    sports = {}
    for unitid, sport, participants, expense in conn.execute(
            "SELECT unitid, sport, participants, expense FROM mart_sport_school ORDER BY unitid"):
        sports.setdefault(unitid, []).append([sport_index[sport], participants, int(expense or 0)])

    medians = {}
    for name, year, measure, n, median in conn.execute(
            "SELECT group_name, year, measure, schools, median FROM mart_group_medians "
            "WHERE group_type = 'division'"):
        medians.setdefault(name, {}).setdefault(year, {})[measure] = [round(median, 4), n]

    conferences = [list(r) for r in conn.execute(
        "SELECT conference, division_group, members_with_data FROM dim_conference ORDER BY conference")]
    divisions = [r[0] for r in conn.execute(
        "SELECT division_group FROM dim_division GROUP BY division_group ORDER BY MIN(division_order)")]
    price_years = [r[0] for r in conn.execute("SELECT DISTINCT year FROM stg_ic_ay ORDER BY year")]

    left_out = []
    with open(os.path.join(ROOT, "data", "seeds", "conference_unmatched.csv"), newline="", encoding="utf-8") as fh:
        for r in csv.DictReader(fh):
            left_out.append([r["wiki_school"], r["conference"], r["reason"].replace("override: ", "")])
    flags = [list(r) for r in conn.execute(
        "SELECT name, flag_note FROM mart_schools WHERE flag_note IS NOT NULL ORDER BY name")]

    bundle = {
        "meta": {
            "latest_year": latest, "first_year": first, "years": years,
            "latest_price_year": max(price_years) if price_years else None,
            "schools": len(schools), "conferences": len(conferences),
            "conference_members": conn.execute(
                "SELECT COUNT(*) FROM dim_institution WHERE conference IS NOT NULL").fetchone()[0],
            "built_on": datetime.date.today().isoformat(),
            "source": "U.S. Department of Education, Equity in Athletics Disclosure Act data files; "
                      "NCES IPEDS published prices",
        },
        "school_columns": SCHOOL_COLUMNS,
        "schools": schools,
        "measures": [m for m, _ in PAGE_MEASURES],
        "values": values,
        "sport_names": sport_names,
        "sports": sports,
        "divisions": divisions,
        "division_medians": medians,
        "conferences": conferences,
        "left_out": left_out,
        "flags": flags,
    }
    path = os.path.join(SITE_DATA, "explorer.js")
    with open(path, "w", encoding="utf-8") as handle:
        handle.write("// Generated by pipeline/build.py. Do not edit by hand.\n")
        handle.write("window.EXPLORER = ")
        json.dump(bundle, handle, separators=(",", ":"))
        handle.write(";\n")
    print("  wrote docs/data/explorer.js ({:,} KB)".format(os.path.getsize(path) // 1024))


def main():
    if not os.path.exists(DB):
        raise SystemExit("No database found. Run pipeline/load.py first.")
    conn = sqlite3.connect(DB)
    run_sql(conn)
    conn.commit()
    export_csv(conn)
    export_page(conn)
    conn.close()


if __name__ == "__main__":
    main()
