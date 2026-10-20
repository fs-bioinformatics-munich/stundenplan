import re
from html import unescape

from bs4 import BeautifulSoup

import json

from .http import BASE, RAW, ensure_session, fetch, get_live

LIST_URL = BASE + "/WBMODHB.cbShowMHBListe"
MODULE_URL = BASE + "/WBMODHB.wbShowMHBReadOnly"


def _list_page(spo_nr, page, name_filter, refresh):
    url = (f"{LIST_URL}?pCaller=tabIdSPOModules&pOrgNr=1&pSort=&pFilter=&pStpStpNr={spo_nr}"
           f"&pFilterNameOrKennung={name_filter}&pFilterSemesterNr=&pPageNr={page}")
    return fetch(url, "modules", f"{spo_nr}_{name_filter}_p{page}", refresh=refresh)


def _rows(text):
    # callback response is XML; the table sits in CDATA blocks
    text = "".join(re.findall(r"<!\[CDATA\[(.*?)\]\]>", text, re.S)) or text
    soup = BeautifulSoup(text, "html.parser")
    out = []
    for tr in soup.select("tr.coRow"):
        a = tr.find("a", href=re.compile(r"pKnotenNr=\d+"))
        tds = tr.find_all("td")
        if not a or len(tds) < 4:
            continue
        out.append({
            "name": a.get_text(strip=True),
            "knoten_nr": int(re.search(r"pKnotenNr=(\d+)", a["href"]).group(1)),
            "module_id": tds[1].get_text(strip=True),
            "org_id": tds[3].get_text(strip=True),
        })
    return out


def list_modules(spo_nr, name_filter="", refresh=False):
    """All modules of an SPO, all pages. Stops when a page repeats or is empty."""
    seen, result, page = set(), [], 1
    while True:
        rows = _rows(_list_page(spo_nr, page, name_filter, refresh))
        new = [r for r in rows if r["knoten_nr"] not in seen]
        if not new:
            break
        for r in new:
            seen.add(r["knoten_nr"])
        result += new
        page += 1
    return result


def module_url(knoten_nr):
    """Module description page (handbook detail view), the evidence page for a module."""
    return f"{MODULE_URL}?pKnotenNr={knoten_nr}&pOrgNr=1"


def module_details(knoten_nr, refresh=False):
    text = fetch(f"{MODULE_URL}?pKnotenNr={knoten_nr}&pOrgNr=1", "module_pages", str(knoten_nr), refresh=refresh)
    t = re.sub(r"\s+", " ", unescape(re.sub(r"<[^>]*>", " ", text)))
    turnus = re.search(r"Turnus (?:(?!Sprache)(.{1,40}?) )?Sprache", t)
    paths = re.findall(r"\[" + SPO_VERSION + r"\]\s+Masterstudium Bioinformatik\s*>\s*Wahlmodule\s*>\s*Wahlmodulkatalog\s+"
                       r"(Methoden und Forschung|Theorie Informatik, Mathematik und Statistik|Theorie Biologie/Biochemie/Chemie|Überfachliche Grundlagen)", t)
    ects = re.search(r"ECTS-Credits (\d+)", t)
    return {"turnus": (turnus.group(1) or "").strip() or None if turnus else None,
            "ects": int(ects.group(1)) if ects else None,
            "catalogs": sorted(set(paths))}


SPO_VERSION = "20261"   # curriculum version label as printed on module pages
SJ_NR = 1623   # academic year 2026/27 in the handbook's node callbacks
CALLBACK_RE = re.compile(r'new CO\.Url\("(wbStpCS\.cbShowGHKs_new\?pStpKnotenNr=(\d+)&pId=[^"&]+&pSjNr=)\d+(&pLangCode=)DE"\)')


def offer_courses(knoten_nr, refresh=False):
    """Courses behind the offer nodes ("Angebotsknoten") of a module page, read as the page does.

    The expand icon of a node calls wbStpCS.cbShowGHKs_new with Accept: CALLBACK on the page's
    session (any handbook page opens it). Callbacks must run one after another (parallel calls get HTTP 404). Exam nodes
    ("Pruefungsknoten") are skipped. Returns [{course_id, node, node_name, semester, text}].
    """
    cache = RAW / "offers" / f"{knoten_nr}.json"
    if cache.exists() and not refresh:
        return json.loads(cache.read_text(encoding="utf-8"))
    page_url = module_url(knoten_nr)
    page = fetch(page_url, "module_pages", str(knoten_nr), refresh=refresh)   # cached page; only node ids are read
    soup = BeautifulSoup(page, "html.parser")
    offer_nodes = []
    for a in soup.select("a.nounderline"):
        m = re.search(r"GHKC_(\d+)_tr", a.get("onclick", ""))
        row = a.find_parent("tr")
        icon = row.find("img", title=True) if row else None
        if m and icon and icon["title"] == "Angebotsknoten":
            first_td = row.find("td")
            offer_nodes.append((m.group(1), re.sub(r"\s+", " ", first_td.get_text(" ")).strip()))
    callbacks = {m.group(2): m for m in CALLBACK_RE.finditer(page)}
    headers = {"Accept": "CALLBACK", "X-Requested-With": "XMLHttpRequest", "Referer": page_url}
    found = []
    for node, node_name in offer_nodes:
        m = callbacks.get(node)
        if not m:
            raise ValueError(f"no callback url for offer node {node} of module {knoten_nr}")
        url = f"{BASE}/{m.group(1)}{SJ_NR}{m.group(3)}EN"
        ensure_session()
        xml = get_live(url, headers)
        if not xml:                       # session expired: callback answers with an empty body
            ensure_session(force=True)
            xml = get_live(url, headers)
            if not xml:
                raise ValueError(f"empty callback answer for offer node {node} of module {knoten_nr}")
        html_ = "".join(re.findall(r"<!\[CDATA\[(.*?)\]\]>", xml, re.S))
        for tr in BeautifulSoup(html_, "html.parser").find_all("tr"):
            link = tr.find("a", href=re.compile(r"pages/slc\.tm\.cp/course/\d+"))
            if not link or tr.find("tr"):      # skip header rows and outer rows of nested tables
                continue
            text = re.sub(r"\s+", " ", tr.get_text(" ")).strip()
            sem = re.search(r"\b(\d{2}[WS])\b", text)
            found.append({"course_id": int(link["href"].rsplit("/", 1)[1]), "node": int(node),
                          "node_name": node_name, "semester": sem.group(1) if sem else None, "text": text})
    cache.parent.mkdir(parents=True, exist_ok=True)
    cache.write_text(json.dumps(found, ensure_ascii=False), encoding="utf-8")
    return found
