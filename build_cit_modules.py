"""CIT Modulkatalog modules that link to a module description PDF (no TUMonline page).

Usage: python3 build_cit_modules.py [--refresh]
Downloads the PDFs to data/cit_modules/, parses them into data/cit_modules.json (rewritten on every run) and writes
data/cit_modules.csv (merged view for checking by hand). Corrections are made by hand in data/cit_modules_manual.json
({"IN5022": {"turnus": "Wintersemester"}}); that file is never overwritten.
Needs `pdftotext`; `export_data.py` reads the merged result.
"""
import csv
import json
import subprocess
import sys
from pathlib import Path

from tum import catalog, cit_modules
from tum.http import download, fetch

DATA = Path(__file__).resolve().parent / "data"
PDF_DIR = DATA / "cit_modules"
SCRAPED = DATA / "cit_modules.json"
MANUAL = DATA / "cit_modules_manual.json"
CSV_PATH = DATA / "cit_modules.csv"
CSV_COLUMNS = ["module_id", "name", "catalog", "catalog_credits", "credits", "type", "teaching_form", "language", "level",
               "turnus", "lecturers", "responsible", "presence_h", "self_study_h", "total_h", "pdf_url", "manual_fields"]


def load_manual():
    if not MANUAL.exists():
        MANUAL.write_text("{}\n", encoding="utf-8")
    return json.loads(MANUAL.read_text(encoding="utf-8"))


def main(refresh):
    html = fetch(catalog.WEB_URL, "catalog", "web", refresh=refresh)
    scraped = {}
    for m in cit_modules.find_pdf_modules(html):
        pdf = download(m["pdf_url"], PDF_DIR / f"{m['module_id']}.pdf", refresh)
        text = subprocess.run(["pdftotext", "-layout", str(pdf), "-"], capture_output=True, text=True, check=True).stdout
        parsed = cit_modules.parse_module_pdf(text)
        missing = [k for k in ("credits", "turnus", "lecturers", "type") if not parsed[k]]
        if missing:
            print(f"{m['module_id']}: not found in the PDF: {', '.join(missing)} (fill in data/cit_modules_manual.json)")
        scraped[m["module_id"]] = {**m, "pdf_file": f"data/cit_modules/{m['module_id']}.pdf", **parsed}
    SCRAPED.write_text(json.dumps(scraped, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    merged = cit_modules.merge_manual(scraped, load_manual())
    with CSV_PATH.open("w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(CSV_COLUMNS)
        for mid, m in merged.items():
            wl = m.get("workload") or {}
            w.writerow([mid, m["name"], m["catalog"], m["catalog_credits"], m.get("credits"), m.get("type"), m.get("teaching_form"),
                        m.get("language"), m.get("level"), m.get("turnus"), "; ".join(m.get("lecturers") or []), m.get("responsible"),
                        wl.get("presence"), wl.get("self"), wl.get("total"), m["pdf_url"], ",".join(m["manual_fields"])])
    print(f"{len(scraped)} modules -> {SCRAPED.name}, {CSV_PATH.name}; PDFs in {PDF_DIR.relative_to(DATA.parent)}/")


if __name__ == "__main__":
    main("--refresh" in sys.argv)
