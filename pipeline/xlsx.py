"""A small reader for the first worksheet of an .xlsx file, standard library only.

EADA publishes Excel, SAS, and SPSS files but no CSV. An .xlsx file is a zip of
XML documents, so it can be read without third-party packages.
"""
import re
import xml.etree.ElementTree as ET
import zipfile

NS = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
REL = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}"


def _col_index(ref):
    letters = re.match(r"[A-Z]+", ref).group(0)
    n = 0
    for ch in letters:
        n = n * 26 + (ord(ch) - 64)
    return n - 1


def _shared_strings(book):
    try:
        data = book.read("xl/sharedStrings.xml")
    except KeyError:
        return []
    out = []
    for si in ET.fromstring(data).iter(NS + "si"):
        out.append("".join(t.text or "" for t in si.iter(NS + "t")))
    return out


def _first_sheet_path(book):
    wb = ET.fromstring(book.read("xl/workbook.xml"))
    first = wb.find(NS + "sheets")[0]
    rid = first.get(REL + "id")
    rels = ET.fromstring(book.read("xl/_rels/workbook.xml.rels"))
    for rel in rels:
        if rel.get("Id") == rid:
            target = rel.get("Target").lstrip("/")
            return target if target.startswith("xl/") else "xl/" + target
    return "xl/worksheets/sheet1.xml"


def rows(fileobj):
    """Yield each row of the first sheet as a list of strings ('' for empty cells)."""
    book = zipfile.ZipFile(fileobj)
    strings = _shared_strings(book)
    with book.open(_first_sheet_path(book)) as handle:
        for _event, elem in ET.iterparse(handle):
            if elem.tag != NS + "row":
                continue
            values = {}
            for cell in elem.iter(NS + "c"):
                kind = cell.get("t")
                if kind == "inlineStr":
                    text = "".join(t.text or "" for t in cell.iter(NS + "t"))
                else:
                    v = cell.find(NS + "v")
                    text = v.text if v is not None and v.text is not None else ""
                    if kind == "s" and text != "":
                        text = strings[int(text)]
                values[_col_index(cell.get("r"))] = text
            elem.clear()
            if values:
                width = max(values) + 1
                yield [values.get(i, "") for i in range(width)]
