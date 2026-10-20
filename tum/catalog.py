"""Module catalog (Wahlmodulkataloge) of the Master Bioinformatics: parse the regulation PDF and the website.

Catalog keys: methods, cs, bio (the three catalogs with a credit minimum), interdisc (Ueberfachliche Grundlagen).
"""
import re
import subprocess
from pathlib import Path

from bs4 import BeautifulSoup

from .http import fetch

WEB_URL = "https://www.cit.tum.de/cit/studium/studiengaenge/master-bioinformatik/modulkatalog/"

LABELS = {
    "methods": "Methoden und Forschung",
    "cs": "Informatik, Mathematik und Statistik",
    "bio": "Biologie/Biochemie/Chemie",
    "interdisc": "Überfachliche Grundlagen",
}
HANDBOOK_NAMES = {
    "Methoden und Forschung": "methods",
    "Theorie Informatik, Mathematik und Statistik": "cs",
    "Theorie Biologie/Biochemie/Chemie": "bio",
    "Überfachliche Grundlagen": "interdisc",
}
PDF_HEADINGS = [
    ("Wahlmodulkatalog Methoden und Forschung", "methods"),
    ("Wahlmodulkatalog Theorie Informatik", "cs"),
    ("Wahlmodulkatalog Theorie Biologie", "bio"),
    ("Wahlmodulkatalog Überfachliche", "interdisc"),
]
ROW_ID = re.compile(r"^\s*([A-Z]{2,}\d{3,}[A-Z0-9]*)\s+(.*)$")
# SWS, credits, exam type (S, M, L, P, W, Proj, S+P, S+W(SL))
ROW_CREDITS = re.compile(r"(\d+(?:,\d)?)\s+(\d+)\s+(S\+P|S\+W\(SL\)|Proj|[SMLPW])\b")


def parse_pdf(pdf_path):
    """{module_id: {"cat", "credits"}} from the elective catalogs of the regulation PDF, plus requirements."""
    text = subprocess.run(["pdftotext", "-layout", str(pdf_path), "-"], capture_output=True, text=True, check=True).stdout
    modules, requirements, cat = {}, {}, None
    for line in text.splitlines():
        for heading, key in PDF_HEADINGS:
            if heading in line:
                cat = key
        if "Erläuterungen" in line:
            cat = None
        m = re.search(r"mindestens (\d+) Credits nachzuweisen", line)
        if m and cat:
            requirements[cat] = int(m.group(1))
        m = re.search(r"Umfang von insgesamt mindestens (\d+) Credits", line)
        if m:
            requirements["total"] = int(m.group(1))
        row = ROW_ID.match(line)
        if cat and row:
            c = ROW_CREDITS.search(row.group(2))
            modules[row.group(1)] = {"cat": cat, "credits": int(c.group(2)) if c else None}
    m = re.search(r"mindestens (\d+) Credits und können Module bis zu einem Umfang\s+von höchstens (\d+) Credits", text)
    if m:
        requirements["interdisc_min"], requirements["interdisc_max"] = int(m.group(1)), int(m.group(2))
    return modules, requirements


def parse_web(refresh=False):
    """{module_id: {"cat", "credits"}} from the three elective tables on the CIT website."""
    html = fetch(WEB_URL, "catalog", "web", refresh=refresh)
    tables = BeautifulSoup(html, "html.parser").find_all("table")[1:4]
    modules = {}
    for cat, table in zip(("methods", "cs", "bio"), tables):
        for tr in table.find_all("tr")[1:]:
            cells = [td.get_text(" ", strip=True) for td in tr.find_all("td")]
            if len(cells) >= 5 and cells[1]:
                mid = re.match(r"[A-Z]{2,}\d{3,}[A-Z0-9]*", cells[1])
                credits = re.sub(r"\D", "", cells[4])
                if mid:
                    modules[mid.group(0)] = {"cat": cat, "credits": int(credits) if credits else None}
    return modules


# Source precedence (decision 2026-10-18): the regulation PDF is the up-to-date source and wins over the
# handbook, which wins over the website (2021 rules). Applies to catalog and credits alike.
def resolve_ects(module_id, handbook_ects, pdf, web):
    """Credits of a module: regulation PDF > handbook module page > website."""
    for value in (pdf.get(module_id, {}).get("credits"), handbook_ects, web.get(module_id, {}).get("credits")):
        if value is not None:
            return value
    return None


def resolve(module_id, handbook_cats, pdf, web):
    """Catalog of a module: regulation PDF > handbook path of the SPO > website."""
    if module_id in pdf:
        return pdf[module_id]["cat"]
    if handbook_cats:
        return handbook_cats[0]
    if module_id in web:
        return web[module_id]["cat"]
    return None
