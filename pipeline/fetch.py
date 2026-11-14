"""Download the EADA and IPEDS files named in sources.py into data/raw/.

Files already on disk are skipped, so the step is safe to re-run. Requests are
spaced out and identify the project plainly; the federal servers reset
connections after bursts.

Usage:  python3 pipeline/fetch.py
"""
import os
import sys
import time
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import sources  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.path.join(ROOT, "data", "raw")
AGENT = "athletics-benchmarking-explorer (public data project)"


def fetch(url, name):
    path = os.path.join(RAW, name + ".zip")
    if os.path.exists(path) and os.path.getsize(path) > 2000:
        return "cached"
    req = urllib.request.Request(url, headers={"User-Agent": AGENT})
    try:
        with urllib.request.urlopen(req, timeout=300) as resp:
            body = resp.read()
    except Exception as exc:  # a year not yet released is reported, not fatal
        return "MISSING ({})".format(exc)
    if not body.startswith(b"PK"):
        return "MISSING (not a zip file)"
    with open(path, "wb") as fh:
        fh.write(body)
    time.sleep(2)
    return "downloaded {:,} bytes".format(len(body))


def main():
    os.makedirs(RAW, exist_ok=True)
    missing = 0
    jobs = [(sources.EADA_URL.format(name=sources.eada_name(y)), sources.eada_name(y))
            for y in sources.EADA_YEARS]
    jobs += [(sources.IPEDS_URL.format(name=sources.ic_ay_name(y)), sources.ic_ay_name(y))
             for y in sources.IPEDS_PRICE_YEARS]
    jobs += [(sources.IPEDS_URL.format(name=sources.drvef_name(y)), sources.drvef_name(y))
             for y in sources.IPEDS_ENROLLMENT_YEARS]
    for url, name in jobs:
        status = fetch(url, name)
        missing += status.startswith("MISSING")
        print("{:<16} {}".format(name, status))
    print("done; {} file(s) missing".format(missing))


if __name__ == "__main__":
    main()
