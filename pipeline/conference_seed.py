"""Build data/seeds/conference_members.csv: conference membership matched to federal unit IDs.

EADA has no conference field. This script reads Wikipedia's lists of NCAA
Division I, II, III and NAIA institutions as they stood in February 2025
(pinned revision IDs, so the 2024-25 season's membership), and matches each
school to its EADA record by state, city, and name. Hand corrections live in
data/seeds/conference_overrides.csv and always win.

This is a maintainer step, not part of `make all`: the reviewed seed files are
kept in the repository. Re-run it only to move to a new season.

Usage:  python3 pipeline/conference_seed.py          (after `make load`)
Text from Wikipedia is used under CC BY-SA 4.0.
"""
import csv
import json
import os
import re
import sqlite3
import sys
import time
import unicodedata
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import wikitables  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WIKI = os.path.join(ROOT, "data", "raw", "wiki")
SEEDS = os.path.join(ROOT, "data", "seeds")
DB = os.path.join(ROOT, "build", "warehouse.sqlite")
SEASON = 2024  # EADA year the membership is matched against (2024-25)

# list key -> (page title, pinned revision, EADA classification codes, conference column)
LISTS = {
    "D1": ("List_of_NCAA_Division_I_institutions", 1276309141, (1, 2, 3), "Primary"),
    "D2": ("List_of_NCAA_Division_II_institutions", 1277340503, (4, 5), "Conference"),
    "D3": ("List_of_NCAA_Division_III_institutions", 1277300429, (6, 7), "Conference"),
    "NAIA": ("List_of_NAIA_institutions", 1276309077, (9, 10), "Conference"),
}
API = "https://en.wikipedia.org/w/api.php?action=parse&oldid={}&prop=text&format=json&formatversion=2"
AGENT = "athletics-benchmarking-explorer (public data project; one-off fetch)"

STATES = {
    "alabama": "AL", "alaska": "AK", "arizona": "AZ", "arkansas": "AR", "california": "CA",
    "colorado": "CO", "connecticut": "CT", "delaware": "DE", "district of columbia": "DC",
    "washington, d.c.": "DC", "d.c.": "DC", "florida": "FL", "georgia": "GA", "hawaii": "HI",
    "idaho": "ID", "illinois": "IL", "indiana": "IN", "iowa": "IA", "kansas": "KS",
    "kentucky": "KY", "louisiana": "LA", "maine": "ME", "maryland": "MD", "massachusetts": "MA",
    "michigan": "MI", "minnesota": "MN", "mississippi": "MS", "missouri": "MO", "montana": "MT",
    "nebraska": "NE", "nevada": "NV", "new hampshire": "NH", "new jersey": "NJ",
    "new mexico": "NM", "new york": "NY", "north carolina": "NC", "north dakota": "ND",
    "ohio": "OH", "oklahoma": "OK", "oregon": "OR", "pennsylvania": "PA", "rhode island": "RI",
    "south carolina": "SC", "south dakota": "SD", "tennessee": "TN", "texas": "TX", "utah": "UT",
    "vermont": "VT", "virginia": "VA", "washington": "WA", "west virginia": "WV",
    "wisconsin": "WI", "wyoming": "WY", "puerto rico": "PR", "u.s. virgin islands": "VI",
}
STOP = {"university", "college", "of", "the", "at", "and", "in", "for", "campus", "main", "a"}


def page_html(key):
    title, revid, _codes, _col = LISTS[key]
    path = os.path.join(WIKI, key + ".json")
    if not os.path.exists(path) or os.path.getsize(path) < 5000:
        os.makedirs(WIKI, exist_ok=True)
        req = urllib.request.Request(API.format(revid), headers={"User-Agent": AGENT})
        with urllib.request.urlopen(req, timeout=120) as resp:
            body = resp.read()
        with open(path, "wb") as fh:
            fh.write(body)
        time.sleep(30)  # Wikimedia asks for slow, identified requests
    with open(path, encoding="utf-8") as fh:
        return json.load(fh)["parse"]["text"]


def tokens(name):
    name = re.sub("[\u2010-\u2015-]", " ", name)
    name = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode("ascii")
    name = name.lower().replace("&", " and ").replace("st.", "saint").replace("mt.", "mount")
    name = name.replace("agricultural and mechanical", "a and m").replace("a and m", "am")
    name = re.sub(r"[^a-z0-9 ]", " ", name.replace("'", ""))
    words = ["saint" if t == "st" else t for t in name.split()]
    return {t for t in words if t not in STOP}


def score(a, b):
    ta, tb = tokens(a), tokens(b)
    if not ta or not tb:
        return 0.0
    return len(ta & tb) / len(ta | tb)


def ascii_lower(text):
    return unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode("ascii").lower().strip()


def state_code(text):
    text = text.strip()
    if len(text) == 2 and text.isupper():
        return text
    return STATES.get(text.lower())


def wiki_rows(key):
    """Every table on the page that lists schools with a state and a conference.

    That is the main membership table plus the table of schools reclassifying
    into the division, which already compete in their new conference. Tables of
    single-sport affiliates and of future applicants are skipped.
    """
    out = []
    for table in wikitables.tables(page_html(key)):
        head = table["header"]
        low = [h.lower() for h in head]
        school_col = next((h for h in head if h.lower().startswith(("school", "institution"))), None)
        state_col = next((h for h in head if h.lower().startswith("state")), None)
        city_col = next((h for h in head if h.lower() in ("city", "location")), None)
        common_col = next((h for h in head if h.lower().startswith("common")), None)
        conf_col = next((h for h in head if h in ("Primary", "Conference")), None)
        if not (school_col and state_col and conf_col):
            continue
        if any(h.startswith(("sport", "applying", "current affiliation")) for h in low):
            continue
        reclass = int(any(h.startswith("reclass") for h in low))
        for r in table["rows"]:
            if r.get(school_col):
                out.append({"school": r.get(school_col, "").rstrip("*").strip(),
                            "common": r.get(common_col, "") if common_col else "",
                            "city": r.get(city_col, "") if city_col else "",
                            "state": state_code(r.get(state_col, "")),
                            "conference": r.get(conf_col, ""), "reclassifying": reclass})
    return out


def clean_conference(name):
    name = re.sub(r"\[.*?\]", "", name).strip()
    name = re.sub(r"\s*\(.*?\)\s*$", "", name).strip()
    return name


def match(row, eada, codes):
    """Return (unitid, method). City, state, and division narrow the field; the name decides."""
    in_state = [e for e in eada if e["state"] == row["state"]]
    city = ascii_lower(row["city"].split(",")[0])
    ranked = []
    for e in in_state:
        s = max(score(row["school"], e["name"]), score(row["common"], e["name"]) if row["common"] else 0)
        same_city = bool(city) and ascii_lower(e["city"]) == city
        same_div = e["code"] in codes
        ranked.append((s + (0.25 if same_city else 0) + (0.1 if same_div else 0), s, same_city, same_div, e))
    ranked.sort(key=lambda r: -r[0])
    if not ranked:
        return None, "no EADA school in state"
    top = ranked[0]
    runner = ranked[1][0] if len(ranked) > 1 else 0
    if top[1] >= 0.99:
        return top[4]["unitid"], "exact name"
    if top[1] >= 0.5 and top[0] - runner >= 0.15:
        return top[4]["unitid"], "name and " + ("city" if top[2] else "state")
    if top[2] and top[1] >= 0.3 and top[0] - runner >= 0.2:
        return top[4]["unitid"], "city and partial name"
    here = [r for r in ranked if r[2] and r[3]]
    if len(here) == 1 and here[0][1] >= 0.2:
        return here[0][4]["unitid"], "only school of this division in the city"
    return None, "ambiguous: best guess {} [{}] ({:.2f})".format(top[4]["name"], top[4]["unitid"], top[1])


def main():
    conn = sqlite3.connect(DB)
    eada = [{"unitid": r[0], "name": r[1], "city": r[2] or "", "state": r[3], "code": r[4]}
            for r in conn.execute(
                "SELECT unitid, institution_name, city_txt, state_cd, classificationcode "
                "FROM stg_eada_inst WHERE year = ?", (SEASON,))]
    by_id = {e["unitid"]: e for e in eada}

    overrides = {}
    opath = os.path.join(SEEDS, "conference_overrides.csv")
    if os.path.exists(opath):
        with open(opath, newline="", encoding="utf-8") as fh:
            for r in csv.DictReader(fh):
                overrides[(r["list"], r["wiki_school"])] = r

    members, unmatched = [], []
    for key in LISTS:
        codes = LISTS[key][2]
        try:
            rows = wiki_rows(key)
        except Exception as exc:
            print("{:<5} not available ({})".format(key, exc))
            continue
        n_ok = 0
        for row in rows:
            conf = clean_conference(row["conference"])
            o = overrides.get((key, row["school"]))
            if o is not None:
                unitid = int(o["unitid"]) if o["unitid"] else None
                method = "override: " + o["note"]
            elif not row["state"]:
                unitid, method = None, "outside the United States"
            else:
                unitid, method = match(row, eada, codes)
            if unitid is None:
                unmatched.append((key, row["school"], row["city"], row["state"] or "", conf, method))
                continue
            if row["reclassifying"] and o is None and by_id[unitid]["code"] not in codes:
                # Listed as moving into this division, but EADA still shows the old one for
                # the season: the move had not happened yet, so the old conference stands.
                unmatched.append((key, row["school"], row["city"], row["state"] or "", conf,
                                  "listed as reclassifying; EADA shows a different division for {}-{}".format(
                                      SEASON, str(SEASON + 1)[2:])))
                continue
            n_ok += 1
            e = by_id[unitid]
            members.append({"unitid": unitid, "conference": conf, "source_list": key,
                            "wiki_school": row["school"], "eada_name": e["name"],
                            "division_differs": 0 if e["code"] in codes else 1,
                            "reclassifying": row["reclassifying"],
                            "match_method": method})
        print("{:<5} {:>4} listed, {:>4} matched".format(key, len(rows), n_ok))

    seen, dupes, drop = {}, [], set()
    for m in members:
        first = seen.get(m["unitid"])
        if first is None:
            seen[m["unitid"]] = m
        elif first["conference"] == m["conference"]:
            first["wiki_school"] += " / " + m["wiki_school"]   # e.g. a men's and a women's college filing together
        elif first["reclassifying"] != m["reclassifying"]:
            # On both a division's main list and another's reclassifying list:
            # the main list is where the school competed that season.
            if first["reclassifying"]:
                seen[m["unitid"]] = m
        else:
            dupes.append((m["unitid"], first["wiki_school"], m["wiki_school"]))
            drop.add(m["unitid"])
    for unitid, a, b in dupes:
        unmatched.append(("", a + " / " + b, "", "", "", "one EADA record matched two schools in different conferences; add an override"))
    members = [m for m in seen.values() if m["unitid"] not in drop]
    with open(os.path.join(SEEDS, "conference_members.csv"), "w", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=list(members[0].keys()))
        w.writeheader()
        w.writerows(sorted(members, key=lambda m: (m["source_list"], m["conference"], m["eada_name"])))
    with open(os.path.join(SEEDS, "conference_unmatched.csv"), "w", newline="", encoding="utf-8") as fh:
        w = csv.writer(fh)
        w.writerow(["list", "wiki_school", "city", "state", "conference", "reason"])
        w.writerows(unmatched)
    print("{} members written, {} unmatched, {} unit IDs matched twice".format(
        len(members), len(unmatched), len(dupes)))
    for d in dupes:
        print("  twice:", d)


if __name__ == "__main__":
    main()
