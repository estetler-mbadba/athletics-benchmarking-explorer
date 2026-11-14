"""Read the data tables out of a Wikipedia page's rendered HTML, standard library only.

Handles rowspan (a conference cell that spans several schools) and drops
footnote markers. Used only by pipeline/conference_seed.py.
"""
import re
from html.parser import HTMLParser


class _Tables(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.tables, self.depth, self.cur, self.row, self.cell, self.skip = [], 0, None, None, None, 0

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if self.skip:
            if tag not in ("br", "img", "hr", "wbr", "link", "meta", "input"):
                self.skip += 1
            return
        if tag == "table":
            self.depth += 1
            if self.depth == 1 and "wikitable" in (a.get("class") or ""):
                self.cur = []
            return
        if self.cur is None or self.depth != 1:
            return
        if tag == "tr":
            self.row = []
        elif tag in ("td", "th"):
            span = re.sub(r"\D", "", a.get("rowspan", "1")) or "1"
            cspan = re.sub(r"\D", "", a.get("colspan", "1")) or "1"
            self.cell = {"text": "", "rowspan": int(span), "colspan": int(cspan), "th": tag == "th"}
        elif tag in ("sup", "style") or (tag == "span" and "sortkey" in (a.get("class") or "")):
            self.skip = 1
        elif tag == "br" and self.cell is not None:
            self.cell["text"] += " "

    def handle_endtag(self, tag):
        if self.skip:
            self.skip -= 1
            return
        if self.cur is not None and self.depth == 1:
            if tag in ("td", "th") and self.cell is not None:
                self.cell["text"] = " ".join(self.cell["text"].split())
                self.row.append(self.cell)
                self.cell = None
            elif tag == "tr" and self.row is not None:
                self.cur.append(self.row)
                self.row = None
        if tag == "table":
            if self.depth == 1 and self.cur is not None:
                self.tables.append(self.cur)
                self.cur = None
            self.depth -= 1

    def handle_data(self, data):
        if self.cell is not None and not self.skip:
            self.cell["text"] += data


def tables(html):
    """Return each wikitable as a list of dicts keyed by its header row, rowspans filled down."""
    parser = _Tables()
    parser.feed(html)
    out = []
    for raw in parser.tables:
        if not raw:
            continue
        # The header is the first row made only of header cells with more than one column;
        # some lists open with a one-cell title row.
        start = 0
        for i, r in enumerate(raw[:3]):
            if len(r) > 1 and all(c["th"] for c in r):
                start = i
                break
        header = []
        for c in raw[start]:
            header += [c["text"]] * c["colspan"]
        pending = {}  # column index -> (text, rows remaining)
        rows = []
        for raw_row in raw[start + 1:]:
            cells, it, col = [], iter(raw_row), 0
            while col < len(header):
                if col in pending:
                    text, left = pending[col]
                    cells.append(text)
                    if left <= 1:
                        del pending[col]
                    else:
                        pending[col] = (text, left - 1)
                    col += 1
                    continue
                c = next(it, None)
                if c is None:
                    break
                for _ in range(c["colspan"]):
                    cells.append(c["text"])
                    if c["rowspan"] > 1:
                        pending[col] = (c["text"], c["rowspan"] - 1)
                    col += 1
            if any(cells):
                rows.append(dict(zip(header, cells)))
        out.append({"header": header, "rows": rows})
    return out
