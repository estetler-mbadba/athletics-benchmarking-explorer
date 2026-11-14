# How the AI was used, and how its work was checked

This project was built by directing Claude Code, an AI coding agent, in plain English. This page records who did what, what the AI got wrong, and what stands between an AI draft and a number someone can rely on.

## Who did what

| Role | Who |
|---|---|
| Set the goal: a public-data athletics benchmark for any college, with no featured college | A person |
| Chose the measures and the rules for what is not compared | A person, from earlier benchmarking work |
| Found the federal files, wrote the Python, SQL, JavaScript, and first-draft text | The AI |
| Matched conference lists to federal IDs and proposed the exceptions | The AI |
| Wrote and ran the automated checks | The AI |
| Reads the result against outside sources and decides what is published | A person (see the review log below) |

## What the AI got wrong during the build

These are kept on purpose. They show why the checks exist.

| Mistake | How it was caught | Fix |
|---|---|---|
| Asked for five columns that do not exist in the EADA institution file | Requested columns were compared with each file's header before loading | Removed; the loader now stops and names any missing column |
| Assumed the institution file's team-expense column was the sum of the sport rows. It is not | Testing the sum for all 8,145 records: it held for 374 | The true identity was found by testing (sport expenses plus unallocated expenses equal the grand total, for every record) and is now a check |
| The name matcher dropped dashes, so "Bethune-Cookman" became one word and matched nothing | Reading the unmatched list | Dashes are treated as spaces |
| Footnote markers leaked into names ("Big West Conferencei]") | Reading the unmatched list | The table reader skips everything inside a footnote |
| Matched four schools that have no federal record to a neighbor: a service academy to another academy, a women's college to a state university in the same city, a branch campus to a flagship, and a campus to a community college | A check for one federal ID matched twice, and reading every match that was not an exact name | Each is now an override with its reason; schools with no record are left out by name |
| Put colleges that were changing divisions in two conferences at once | The same duplicate check | The main list decides the season's conference; a move counts only when the federal file shows the new division |
| Fetched four Wikipedia pages in quick succession and was refused | The response was an error page, not a table | Requests are spaced 30 seconds apart, pages are cached, and revision IDs are pinned |
| A scatter chart of an eight-college group hid two of them as "beyond the scale" | Looking at the rendered chart | Trimming applies only to groups of more than 40 |
| A median line ran through value labels on the bar chart | Looking at the rendered chart | The line is drawn first and labels sit on a background halo |
| A y-axis title overlapped its tick labels | Looking at the rendered chart | The title moved into the chart's subtitle |

## Automated checks

`pipeline/checks.py` runs 17 checks on every build and stops the build if any fail.

- **Internal consistency.** Every year is loaded in full with one record per college. For every college in every year: sport expenses plus unallocated expenses equal total expense, sport rosters equal the participant total, aid to men's, women's, and coed teams equals total aid, and athletes counted once never exceed roster spots.
- **Model integrity.** The school-year mart is unique on its grain. Ratios stay in range and are blank when the denominator is zero. Division III colleges show no aid measures. Every SQL median is recomputed in Python (8,808 medians). Rank 1 is the highest value in every conference. Each price is from the same year or the latest earlier one. The page file carries every college in the database.
- **Outside sources.** Every conference member is a real federal record in one conference only. Every school left out has a stated reason. Conference sizes are plausible. Full-time undergraduate counts are compared with IPEDS fall enrollment.

The outside checks cannot catch an error in what a college reported to the Department of Education.

## Human review log

The automated checks cannot judge whether a comparison is fair. These reviews are for a person. Until a row is signed, treat the page as a draft.

| Check | What the comparison found | Signed off |
|---|---|---|
| Five colleges' figures read against the Department of Education's public EADA lookup (ope.ed.gov/athletics) | Not yet reviewed | |
| Three conference rosters read against the conferences' own 2024-25 membership pages | Not yet reviewed | |
| The list of schools left out, read for reasonableness | Not yet reviewed | |
| Every generated finding sentence read against its chart and table, for three colleges in different divisions | Not yet reviewed | |
| The definition of teams read against local practice | Not yet reviewed | |

## Responsible use

The figures are institution-level public records. No student-level data is used, and nothing is licensed or confidential. The page ranks colleges on self-reported figures, so it says so beside the rankings, states that rank 1 is the highest value and not the best one, and lists what the data cannot show. The page states that a gap in women's share of athletes does not by itself show noncompliance.
