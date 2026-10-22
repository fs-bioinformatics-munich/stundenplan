"""Modules of the CIT Modulkatalog (FPSO 2026 section) whose name links to a module description PDF
instead of a TUMonline module page: find the links, parse the PDFs, merge hand-made corrections."""
import re
from urllib.parse import urljoin

from bs4 import BeautifulSoup

from .catalog import WEB_URL

TABLE_CATALOGS = ("methods", "cs", "bio", "interdisc")   # elective tables 1 to 4 of the page, as in catalog.parse_web


def find_pdf_modules(html, base_url=WEB_URL):
    """[{module_id, name, catalog, catalog_credits, pdf_url}] for every table row whose name links to a PDF."""
    tables = BeautifulSoup(html, "html.parser").find_all("table")[1:5]
    found = []
    for catalog, table in zip(TABLE_CATALOGS, tables):
        for tr in table.find_all("tr")[1:]:
            cells = tr.find_all("td")
            link = cells[0].find("a", href=True) if cells else None
            if len(cells) < 5 or not link or not link["href"].lower().split("?")[0].endswith(".pdf"):
                continue
            module_id = re.match(r"[A-Z]{2,}\d{3,}[A-Z0-9]*", cells[1].get_text(" ", strip=True))
            credits = re.sub(r"\D", "", cells[4].get_text(strip=True))
            if module_id:
                found.append({"module_id": module_id.group(0), "name": cells[0].get_text(" ", strip=True), "catalog": catalog,
                              "catalog_credits": int(credits) if credits else None, "pdf_url": urljoin(base_url, link["href"])})
    return found


# Keys of the standardized two-column module description, German and English. They tell key rows from value rows and
# join keys that wrap over two lines ("Angestrebte" / "Lernergebnisse").
KNOWN_KEYS = [
    "Titel", "Title", "Typ", "Type", "Credits", "Lehrform/SWS", "Lehrform / SWS", "Sprache", "Language", "Modulniveau",
    "Arbeitsaufwand", "Angestrebte Lernergebnisse", "Intended Learning Outcomes", "Inhalt", "Contents",
    "Voraussetzungen", "Prerequisites", "Prüfung", "Examination", "Exam", "Literatur", "Literatur/Literature", "Literature",
    "Medienformen", "Media", "Lehr- und Lernmethode", "Teaching and Learning Methods", "Turnus", "Häufigkeit",
    "Modulverantwortlicher", "Dozenten",
]
_PARTIAL_KEYS = {" ".join(k.split()[:n]) for k in KNOWN_KEYS for n in range(1, len(k.split()))} - set(KNOWN_KEYS)
_BY_LENGTH = sorted(KNOWN_KEYS, key=len, reverse=True)
_PARTIAL_BY_LENGTH = sorted(_PARTIAL_KEYS, key=len, reverse=True)
_GAP = re.compile(r"\s{2,}")


def _canon(key):
    return re.sub(r"\s*/\s*", "/", key)


def _key_start(text):
    """(key, rest of the row) if the row starts with a known key; a key the PDF wraps (first line) may stand alone."""
    for k in _BY_LENGTH:
        if text == k or text.startswith(k + " "):
            return _canon(k), text[len(k):].strip()
    for k in _PARTIAL_BY_LENGTH:
        if text == k or re.match(re.escape(k) + r"\s", text):
            return k, text[len(k):].strip()
    return None


def _extends_known_key(current, fragment):
    joined = f"{current} {fragment}"
    return any(_canon(k) == joined or _canon(k).startswith(joined + " ") for k in KNOWN_KEYS)


def parse_module_pdf(text):
    """Key/value table of a module description PDF (text from `pdftotext -layout`): {"fields": {key: value}, ...}.

    Keys stand in the first column, values in the second; keys and values wrap over several lines. Rows at the
    indentation of the keys start a new key unless they continue a wrapped key; more indented rows continue the value.
    Text above the first key (the title) is ignored.
    """
    fields, key = {}, None
    for page in text.split("\f"):
        rows = [r for r in page.splitlines() if r.strip()]
        indents = [len(r) - len(r.lstrip()) for r in rows if _key_start(r.strip())]
        key_indent = min(indents) if indents else None    # a page of continuation rows only has no key column
        for row in rows:
            stripped = row.strip()
            at_key_col = key_indent is not None and len(row) - len(row.lstrip()) == key_indent
            fragment = _GAP.split(stripped, maxsplit=1)
            if at_key_col and key is not None and _extends_known_key(key, fragment[0]):
                old, key = key, f"{key} {fragment[0]}"
                fields[key] = f"{fields.pop(old)} {' '.join(fragment[1:])}"
            elif at_key_col and _key_start(stripped):
                key, value = _key_start(stripped)
                fields[key] = value
            elif at_key_col and len(fragment) == 2:        # a key this parser does not know: keep it for the hand check
                key = _canon(fragment[0])
                fields[key] = fragment[1]
            elif key is not None:
                fields[key] = f"{fields[key]} {stripped}"
    fields = {k: re.sub(r"\s+", " ", v).strip() for k, v in fields.items()}
    return {"fields": fields, **_normalize(fields)}


def _hours(text, label):
    found = re.search(label + r"\s+(\d+)\s*(?:Stunden|h)\b", text)
    return int(found.group(1)) if found else None


def _normalize(f):
    """The fields the website shows, taken from the raw key/value table (None if the PDF does not have them)."""
    credits = re.match(r"\d+", f.get("Credits", ""))
    work = f.get("Arbeitsaufwand", "")
    lecturers = [x.strip() for x in f.get("Dozenten", "").split(";") if x.strip()]
    return {
        "title": f.get("Titel") or f.get("Title"),
        "type": f.get("Typ"),
        "credits": int(credits.group(0)) if credits else None,
        "teaching_form": f.get("Lehrform/SWS"),
        "language": f.get("Sprache"),
        "level": f.get("Modulniveau"),
        "workload": {"presence": _hours(work, "Präsenzstunden"), "self": _hours(work, "Eigenstudium"), "total": _hours(work, "Gesamtaufwand")},
        "turnus": f.get("Turnus", f.get("Häufigkeit")),
        "responsible": f.get("Modulverantwortlicher"),
        "lecturers": lecturers,
    }


def merge_manual(scraped, manual):
    """Scraped modules with the hand-made corrections laid over them; `manual_fields` lists what was corrected.

    A correction for a module that was not scraped is an error (usually a typo in the module number).
    """
    unknown = sorted(set(manual) - set(scraped))
    if unknown:
        raise ValueError(f"manual corrections for unknown modules: {', '.join(unknown)}")
    return {mid: {**m, **manual.get(mid, {}), "manual_fields": sorted(manual.get(mid, {}))} for mid, m in scraped.items()}


def export_records(merged, modules):
    """Records for schedule.json: the merged module descriptions plus the credits that count and where they come from.

    Counted credits: hand-corrected value > the value the app already resolves for the module (FPSO > handbook >
    website table, `modules` = exported module infos) > website table > module description PDF. The description PDF
    is one more source: any disagreement between sources is flagged (`credits_conflict`).
    """
    records = []
    for mid, m in merged.items():
        info = modules.get(mid)
        sources = {
            "pdf": info["ects_sources"]["pdf"] if info else None,
            "handbook": info["ects_sources"]["handbook"] if info else None,
            "web": info["ects_sources"]["web"] if info else m.get("catalog_credits"),
            "module_pdf": m.get("credits"),
        }
        if "credits" in m["manual_fields"]:
            credits, used_from = m["credits"], "manual"
        elif info and info["ects"] is not None:
            credits, used_from = info["ects"], info["ects_used_from"]
        else:
            used_from = next((k for k in ("web", "module_pdf") if sources[k] is not None), None)
            credits = sources[used_from] if used_from else None
        if credits is None:
            raise ValueError(f"{mid}: no credits in any source (fill in data/cit_modules_manual.json)")
        records.append({
            **{k: v for k, v in m.items() if k not in ("fields", "catalog_credits", "name", "catalog", "module_id")},
            "id": mid, "name": m["name"], "catalog": (info or {}).get("catalog") or m["catalog"],
            "credits": credits, "credits_used_from": used_from, "credits_sources": sources,
            "credits_conflict": len({v for v in sources.values() if v is not None} | {credits}) > 1,
        })
    return records
