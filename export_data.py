"""Export stundenplan.db to app/public/data/schedule.json for the static scheduler front end.

Usage: python3 export_data.py [out.json]
Fails (non-zero exit) on any inconsistency instead of guessing.
"""
import json
import re
import sqlite3
import sys
from datetime import datetime
from pathlib import Path

from tum import catalog as catalogs
from tum.db import DB_PATH

ROOT = Path(__file__).resolve().parent
OUT = ROOT / "app" / "public" / "data" / "schedule.json"
CATALOG_JSON = ROOT / "data" / "modulkatalog.json"   # made by build_catalog.py
TERM = "WS 2026/27"
LANGUAGE_ORG = "TUZEIO2"          # language centre: its courses get category "language"
WEEKDAYS = {"Montag": 1, "Dienstag": 2, "Mittwoch": 3, "Donnerstag": 4, "Freitag": 5, "Samstag": 6, "Sonntag": 7}
CATEGORY = {"VO": "lecture", "VI": "lecture", "SE": "seminar", "PR": "practical", "FO": "research", "WS": "workshop"}
SHARED = "(shared)"
ID_ONLY = re.compile(r"^[\w\s,;/\-\[\]]+$")


def natural(name):
    return [int(t) if t.isdigit() else t for t in re.split(r"(\d+)", name)]


def label(title):
    """Title without leading/trailing '(IN2309, IN2126)' / '[MA5617]' groups that only hold module ids."""
    t = title.strip()
    for pattern in (r"\s*[(\[]([^)\]]*)[)\]]\s*$", r"^\s*[(\[]([^)\]]*)[)\]]\s*"):
        m = re.search(pattern, t)
        if m and re.search(r"[A-Z]{2,}[A-Z0-9]*\d{3,}", m.group(1)) and ID_ONLY.match(m.group(1)):
            t = (t[:m.start()] + t[m.end():]).strip()
    return t


def slot_json(r):
    if r["weekday"] not in WEEKDAYS:
        raise ValueError(f"unknown weekday {r['weekday']!r}")
    return {"day": WEEKDAYS[r["weekday"]], "start": r["start_time"], "end": r["end_time"], "room": r["room"],
            "first": r["first_date"], "last": r["last_date"], "n": r["n_dates"]}


def main(out):
    con = sqlite3.connect(DB_PATH)
    con.row_factory = sqlite3.Row

    if not CATALOG_JSON.exists():
        sys.exit(f"{CATALOG_JSON} missing: run build_catalog.py first")
    cat_src = json.loads(CATALOG_JSON.read_text(encoding="utf-8"))
    modules = {}
    for r in con.execute("SELECT * FROM module"):
        hb = [catalogs.HANDBOOK_NAMES[c] for c in (r["catalogs"] or "").split("|") if c]
        mid = r["module_id"]
        sources = {"pdf": cat_src["pdf"].get(mid, {}).get("credits"), "handbook": r["ects"],
                   "web": cat_src["web"].get(mid, {}).get("credits")}
        used = catalogs.resolve_ects(mid, r["ects"], cat_src["pdf"], cat_src["web"])
        used_from = next((k for k in ("pdf", "handbook", "web") if sources[k] is not None), None)
        modules[mid] = {"name": r["name"], "url": r["module_url"], "turnus": r["turnus"], "org": r["org_id"],
                        "ects": used, "ects_sources": sources, "ects_used_from": used_from,
                        # sources that disagree: always shown in the UI (boxes, popup, credits footnote)
                        "ects_conflict": len({v for v in sources.values() if v is not None}) > 1,
                        "catalog": catalogs.resolve(mid, hb, cat_src["pdf"], cat_src["web"])}
    mods_of, courses_of = {}, {}
    for r in con.execute("SELECT module_id, course_id FROM module_course"):
        mods_of.setdefault(r["course_id"], []).append(r["module_id"])
        courses_of.setdefault(r["module_id"], []).append(r["course_id"])
    lecturers = {}
    for r in con.execute("SELECT course_id, name, role FROM lecturer ORDER BY (role!='Head'), name"):
        lecturers.setdefault(r["course_id"], []).append({"name": r["name"], "role": r["role"]})
    slots = {}
    for r in con.execute("SELECT * FROM slot ORDER BY weekday, start_time, id"):
        slots.setdefault(r["course_id"], []).append(r)
    groups = {}
    for r in con.execute("SELECT course_id, group_name FROM course_group"):
        groups.setdefault(r["course_id"], []).append(r["group_name"])

    def credit_module(mods):
        """The module whose credits a course counts for: highest ECTS (a course listed in two exclusive modules counts once)."""
        return max(mods, key=lambda m: (modules[m]["ects"] or 0, m), default=None)

    def base(r):
        mods = sorted(mods_of.get(r["course_id"], []))
        cm = credit_module(mods)
        return {"id": r["course_id"], "type": r["type"], "title": r["title"], "label": label(r["title"]),
                "modules": mods, "credit_module": cm, "ects": modules[cm]["ects"] if cm else None,
                "ects_conflict": modules[cm]["ects_conflict"] if cm else False,
                "catalog": modules[cm]["catalog"] if cm else None, "language": r["language"],
                "lecturers": lecturers.get(r["course_id"], []),
                "registration": {"open": bool(r["reg_open"]), "status": r["reg_status"], "info": r["reg_info"],
                                 "url": r["registration_url"]},
                "course_url": r["course_url"]}

    courses, exercises, no_dates = [], [], []
    for r in con.execute("SELECT * FROM course ORDER BY course_id"):
        c = base(r)
        sl = slots.get(r["course_id"], [])
        if r["type"] == "UE":
            by_group = {}
            for s in sl:
                by_group.setdefault(s["group_name"], []).append(slot_json(s))
            fixed = by_group.pop(SHARED, [])
            names = {g for g in groups.get(r["course_id"], []) if g != SHARED and not g.startswith("Standardgruppe")} | set(by_group)
            if not names and not fixed:           # exercise with one unnamed group
                names = {"Standardgruppe"}
            c["fixed_slots"] = fixed
            c["groups"] = [{"name": g, "slots": by_group.get(g, [])} for g in sorted(names, key=natural)]
            exercises.append(c)
            continue
        if r["type"] not in CATEGORY:
            raise ValueError(f"course {r['course_id']}: type {r['type']!r} has no category")
        c["category"] = CATEGORY[r["type"]]
        if any(modules[m]["org"] == LANGUAGE_ORG for m in c["modules"]):
            c["category"] = "language"
        c["slots"] = [slot_json(s) for s in sl]
        if not c["slots"]:
            no_dates.append(c["id"])
        courses.append(c)

    lecture_ids = {c["id"] for c in courses if c["category"] == "lecture"}
    for e in exercises:
        e["lecture_ids"] = sorted(lecture_ids & {cid for m in e["modules"] for cid in courses_of.get(m, [])})
        if not e["lecture_ids"]:
            print(f"warning: exercise {e['id']} ({e['label']}) has no lecture in its module(s)")

    # consistency checks
    ids = [c["id"] for c in courses] + [e["id"] for e in exercises]
    assert len(ids) == len(set(ids)), "duplicate course ids"
    n_courses = con.execute("SELECT COUNT(*) FROM course").fetchone()[0]
    assert len(ids) == n_courses, f"exported {len(ids)} of {n_courses} courses"
    for e in exercises:
        assert set(e["lecture_ids"]) <= lecture_ids
    for c in courses + exercises:
        for m in c["modules"]:
            assert m in modules, f"unknown module {m}"
        for s in c.get("slots", []) + c.get("fixed_slots", []) + [x for g in c.get("groups", []) for x in g["slots"]]:
            assert s["start"] < s["end"], f"course {c['id']}: bad time {s}"

    req = cat_src["requirements"]
    catalog_info = {k: {"label": catalogs.LABELS[k], "min": req.get(k)} for k in ("methods", "cs", "bio")}
    catalog_info["interdisc"] = {"label": catalogs.LABELS["interdisc"], "min": req.get("interdisc_min"), "max": req.get("interdisc_max")}
    assert all(v["min"] is not None for v in catalog_info.values()), f"missing credit minimum in {req}"
    data = {"term": TERM, "generated": datetime.now().isoformat(timespec="seconds"),
            "catalogs": catalog_info, "total_min": req["total"],
            "modules": {k: {kk: vv for kk, vv in v.items() if kk != "org"} for k, v in modules.items()},
            "courses": courses, "exercises": exercises, "no_dates": no_dates}
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")
    cats = {}
    for c in courses:
        cats[c["category"]] = cats.get(c["category"], 0) + 1
    print(f"wrote {out}: {len(courses)} courses {cats}, {len(exercises)} exercises, {len(no_dates)} without dates")
    by_cat = {}
    for c in courses:
        if c["category"] == "lecture":
            by_cat[c["catalog"]] = by_cat.get(c["catalog"], 0) + 1
    print(f"lectures by catalog: {by_cat}")
    conflicts = {m: v["ects_sources"] for m, v in modules.items() if v["ects_conflict"]}
    print(f"modules with credit discrepancies between sources: {conflicts}")


if __name__ == "__main__":
    main(Path(sys.argv[1]) if len(sys.argv) > 1 else OUT)
