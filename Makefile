# One command rebuilds everything from the federal source files:  make all
.PHONY: all fetch load build check serve conferences

all: fetch load build check

fetch:      ## download EADA and IPEDS files (skips files already on disk)
	python3 pipeline/fetch.py

load:       ## load raw files and seed tables into build/warehouse.sqlite
	python3 pipeline/load.py

build:      ## run sql/*.sql and export the marts
	python3 pipeline/build.py

check:      ## accuracy checks; exits non-zero if any fail
	python3 pipeline/checks.py

serve:      ## preview the page at http://localhost:8793
	python3 -m http.server 8793 --directory docs

conferences: ## maintainer step: rebuild the conference match from the pinned Wikipedia revisions
	python3 pipeline/conference_seed.py
