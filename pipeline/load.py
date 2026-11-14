"""Load the raw federal files and the seed tables into a SQLite database.

Staging tables (stg_*) hold the federal data as published, restricted to the
columns named in sources.py, with a `year` column added. Nothing is cleaned
here beyond turning blanks into NULL and numbers into numbers. All business
logic lives in sql/.

Usage:  python3 pipeline/load.py
"""
import csv
import io
import os
import sqlite3
import sys
import zipfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import sources  # noqa: E402
import xlsx  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.path.join(ROOT, "data", "raw")
SEEDS = os.path.join(ROOT, "data", "seeds")
DB = os.path.join(ROOT, "build", "warehouse.sqlite")

TEXT_COLUMNS = {"institution_name", "city_txt", "state_cd", "classification_name",
                "sector_name", "sports"}


def clean(column, value):
    """Blank and '.' mean 'not reported'; store them as NULL."""
    value = (value or "").strip()
    if value in ("", "."):
        return None
    if column in TEXT_COLUMNS:
        return value
    try:
        number = float(value)
    except ValueError:
        return value
    return int(number) if number.is_integer() else number


def create(conn, table, columns):
    conn.execute("DROP TABLE IF EXISTS {}".format(table))
    cols = ", ".join('"{}"'.format(c.lower()) for c in columns)
    conn.execute("CREATE TABLE {} (year INTEGER, source_file TEXT, {})".format(table, cols))


def insert(conn, table, year, source, header, rows, columns):
    lookup = {h.strip().lower(): i for i, h in enumerate(header)}
    wanted = [c.lower() for c in columns]
    absent = [c for c in wanted if c not in lookup]
    if absent:
        raise SystemExit("{} {}: columns missing from the file: {}".format(table, source, absent))
    batch = []
    for row in rows:
        values = [clean(c, row[lookup[c]] if lookup[c] < len(row) else "") for c in wanted]
        if values[0] is None:
            continue
        batch.append([year, source] + values)
    marks = ", ".join("?" for _ in range(len(wanted) + 2))
    conn.executemany("INSERT INTO {} VALUES ({})".format(table, marks), batch)
    return len(batch)


def eada_member(archive, kind):
    """The institution file starts with 'inst'; the sport file with 'school'."""
    for name in archive.namelist():
        low = name.lower()
        if low.endswith(".xlsx") and low.startswith(kind):
            return name
    raise SystemExit("No {} workbook in {}".format(kind, archive.filename))


def load_eada(conn):
    create(conn, "stg_eada_inst", sources.EADA_INST_COLUMNS)
    create(conn, "stg_eada_sport", sources.EADA_SPORT_COLUMNS)
    for year in sources.EADA_YEARS:
        name = sources.eada_name(year)
        path = os.path.join(RAW, name + ".zip")
        if not os.path.exists(path):
            print("  {:<16} skipped (not downloaded)".format(name))
            continue
        archive = zipfile.ZipFile(path)
        for table, kind, columns in (("stg_eada_inst", "inst", sources.EADA_INST_COLUMNS),
                                     ("stg_eada_sport", "school", sources.EADA_SPORT_COLUMNS)):
            member = eada_member(archive, kind)
            it = xlsx.rows(io.BytesIO(archive.read(member)))
            header = next(it)
            n = insert(conn, table, year, name + "/" + member, header, it, columns)
            print("  {:<16} {:<15} {:>7,} rows".format(name, table, n))


def load_ipeds(conn):
    load_ipeds_table(conn, "stg_ic_ay", sources.IC_AY_COLUMNS, sources.IPEDS_PRICE_YEARS, sources.ic_ay_name)
    load_ipeds_table(conn, "stg_drvef", sources.DRVEF_COLUMNS, sources.IPEDS_ENROLLMENT_YEARS, sources.drvef_name)


def load_ipeds_table(conn, table, columns, years, namer):
    create(conn, table, columns)
    for year in years:
        name = namer(year)
        path = os.path.join(RAW, name + ".zip")
        if not os.path.exists(path):
            print("  {:<16} skipped (not released when built)".format(name))
            continue
        archive = zipfile.ZipFile(path)
        members = [m for m in archive.namelist() if m.lower().endswith(".csv")]
        revised = [m for m in members if m.lower().endswith("_rv.csv")]
        member = (revised or members)[0]
        with archive.open(member) as handle:
            reader = csv.reader(io.TextIOWrapper(handle, encoding="utf-8-sig", errors="replace"))
            header = next(reader)
            n = insert(conn, table, year, name + "/" + member, header,
                       (r for r in reader if r), columns)
        print("  {:<16} {:<15} {:>7,} rows".format(name, table, n))


def load_seed(conn, filename, table):
    path = os.path.join(SEEDS, filename)
    with open(path, newline="", encoding="utf-8") as handle:
        reader = csv.reader(handle)
        header = next(reader)
        rows = [[int(v) if v.isdigit() else (v if v != "" else None) for v in row]
                for row in reader if row and len(row) == len(header)]
    conn.execute("DROP TABLE IF EXISTS {}".format(table))
    conn.execute("CREATE TABLE {} ({})".format(table, ", ".join(header)))
    conn.executemany("INSERT INTO {} VALUES ({})".format(table, ", ".join("?" for _ in header)), rows)
    print("  {:<32} {:>7,} rows (seed)".format(table, len(rows)))


def main():
    os.makedirs(os.path.dirname(DB), exist_ok=True)
    conn = sqlite3.connect(DB)
    print("Loading staging tables into", os.path.relpath(DB, ROOT))
    load_eada(conn)
    load_ipeds(conn)
    load_seed(conn, "state_fips.csv", "seed_state")
    load_seed(conn, "conference_members.csv", "seed_conference_member")
    load_seed(conn, "institution_flags.csv", "seed_institution_flag")
    conn.commit()
    conn.close()


if __name__ == "__main__":
    main()
