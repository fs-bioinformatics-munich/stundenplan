"""Parse the module catalog sources into data/modulkatalog.json and write data/catalog_report.md.

Sources: data/fpso_modulkatalog.pdf (regulation, needs `pdftotext`) and the CIT website (cached in raw/catalog/).
Usage: python3 build_catalog.py [--refresh]
"""
import json
import sqlite3
import sys
from pathlib import Path

from tum import catalog
from tum.db import DB_PATH

ROOT = Path(__file__).resolve().parent
PDF = ROOT / "data" / "fpso_modulkatalog.pdf"
OUT = ROOT / "data" / "modulkatalog.json"
REPORT = ROOT / "data" / "catalog_report.md"


def main(refresh):
    pdf, requirements = catalog.parse_pdf(PDF)
    web = catalog.parse_web(refresh)
    con = sqlite3.connect(DB_PATH)
    mods = {r[0]: (r[1], r[2], r[3]) for r in con.execute("SELECT module_id, name, ects, catalogs FROM module")}
    hb = {m: [catalog.HANDBOOK_NAMES[c] for c in (cats or "").split("|") if c] for m, (_, _, cats) in mods.items()}

    lines = ["# Module catalog report", "",
             "Precedence for catalog and credits: **regulation PDF (up to date) > handbook > website (FPSO 2026)**.", "",
             f"PDF: {len(pdf)} modules, website: {len(web)} modules, handbook (SPO 20261): "
             f"{sum(1 for v in hb.values() if v)} modules with a catalog path.", ""]
    problems = []
    for m in sorted(set(pdf) | set(web) | {k for k, v in hb.items() if v}):
        cats = {"pdf": pdf.get(m, {}).get("cat"), "web": web.get(m, {}).get("cat"), "handbook": hb.get(m) or None}
        seen = {cats["pdf"], cats["web"], *(cats["handbook"] or [])} - {None}
        resolved = catalog.resolve(m, hb.get(m, []), pdf, web)
        if len(seen) > 1:
            problems.append(f"- {m} {mods.get(m, ('?',))[0]}: pdf={cats['pdf']}, web={cats['web']}, handbook={cats['handbook']} -> used `{resolved}`")
        ects = mods.get(m, (None, None, None))[1]
        used = catalog.resolve_ects(m, ects, pdf, web)
        for src, credits in (("handbook", ects), ("web", web.get(m, {}).get("credits")), ("pdf", pdf.get(m, {}).get("credits"))):
            if credits is not None and used is not None and credits != used:
                problems.append(f"- {m} {mods[m][0]}: {src} says {credits} credits, used {used} (PDF > handbook > website)")
    lines += ["## Disagreements between sources", ""] + (problems or ["none"]) + [""]
    absent = sorted((set(pdf) | set(web)) - set(mods))
    lines += ["## In PDF or website but not in the SPO 20261 module list (no courses can be shown)", "", ", ".join(absent) or "none", ""]
    uncovered = sorted(m for m, v in hb.items() if v and v[0] != "interdisc" and m not in pdf and m not in web)
    lines += ["## In a handbook catalog but in neither PDF nor website (category from handbook only)", "",
              ", ".join(f"{m} ({mods[m][0]})" for m in uncovered) or "none", ""]
    REPORT.write_text("\n".join(lines), encoding="utf-8")

    OUT.write_text(json.dumps({"requirements": requirements, "labels": catalog.LABELS, "pdf": pdf, "web": web},
                              ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"wrote {OUT} and {REPORT}; requirements {requirements}; {len(problems)} disagreement(s)")


if __name__ == "__main__":
    main("--refresh" in sys.argv)
