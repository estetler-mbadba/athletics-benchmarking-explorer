"""Catalog of the federal files this project uses.

EADA: U.S. Department of Education, Office of Postsecondary Education,
Equity in Athletics Disclosure Act data files, https://ope.ed.gov/athletics/
IPEDS: National Center for Education Statistics, complete data files,
https://nces.ed.gov/ipeds/datacenter/DataFiles.aspx

Every column the project reads is named here. Nothing reaches the database
unless it is listed in this file, which keeps the data dictionary honest.
"""

EADA_URL = "https://ope.ed.gov/athletics/api/dataFiles/file?fileName={name}.zip"
IPEDS_URL = "https://nces.ed.gov/ipeds/datacenter/data/{name}.zip"

# EADA reporting years, named by the fall they start in: 2024 means 2024-25.
# 2020-21 is left out on purpose: many programs paused or cut seasons that year.
EADA_YEARS = [2021, 2022, 2023, 2024]

# IPEDS price files (IC_AY), named by the fall the academic year starts in.
# When the matching price year is not yet released, the build uses the latest
# earlier year and marks the gap (see sql/01_core_model.sql).
IPEDS_PRICE_YEARS = [2021, 2022, 2023, 2024]


# IPEDS fall enrollment (derived file), used only as an outside check on EADA's
# full-time undergraduate counts. The latest fall that has been released.
IPEDS_ENROLLMENT_YEARS = [2023]


def eada_name(year):
    return "EADA_{}-{}".format(year, year + 1)


def ic_ay_name(year):
    return "IC{}_AY".format(year)


def drvef_name(year):
    return "DRVEF{}".format(year)


# Institution file: one row per institution per year.
EADA_INST_COLUMNS = [
    "unitid", "institution_name", "city_txt", "state_cd", "ClassificationCode",
    "classification_name", "sector_cd", "sector_name",
    "EFMaleCount", "EFFemaleCount", "EFTotalCount",
    "STUDENTAID_MEN", "STUDENTAID_WOMEN", "STUDENTAID_COED", "STUDENTAID_TOTAL",
    "RECRUITEXP_MEN", "RECRUITEXP_WOMEN", "RECRUITEXP_COED", "RECRUITEXP_TOTAL",
    "HDCOACH_SAL_FTE_MEN", "HDCOACH_SAL_FTE_WOMN",
    "FTE_HDCOACH_MEN", "FTE_HDCOACH_WOMEN", "FTE_HDCOACH_COED",
    "FTE_ASCOACH_MEN", "FTE_ASCOACH_WOMEN", "FTE_ASCOACH_COED",
    "IL_SUM_PARTIC_MEN", "IL_SUM_PARTIC_WOMEN",
    "UNDUP_CT_PARTIC_MEN", "UNDUP_CT_PARTIC_WOMEN",
    "IL_EXPENSE_MENALL", "IL_EXPENSE_WOMENALL", "IL_TOTAL_EXPENSE_ALL",
    "TOT_EXPENSE_ALL_NOTALLOC", "GRND_TOTAL_EXPENSE", "GRND_TOTAL_REVENUE",
]

# Sport file: one row per sport per institution per year.
EADA_SPORT_COLUMNS = [
    "unitid", "Sports", "SPORTSCODE",
    "PARTIC_MEN", "PARTIC_WOMEN", "PARTIC_COED_MEN", "PARTIC_COED_WOMEN",
    "SUM_PARTIC_MEN", "SUM_PARTIC_WOMEN",
    "EXPENSE_MENALL", "EXPENSE_WOMENALL", "TOTAL_EXPENSE_ALL",
]

# IPEDS published prices: in-state tuition and fees, books, on-campus room and board, other.
IC_AY_COLUMNS = ["UNITID", "CHG2AY3", "CHG4AY3", "CHG5AY3", "CHG6AY3"]

# IPEDS full-time undergraduate enrollment, fall.
DRVEF_COLUMNS = ["UNITID", "EFUGFT"]
