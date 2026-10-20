"""Crawl SPO modules -> courses -> groups into stundenplan.db. Resumable via raw/ cache.

Usage: python3 scrape.py [--module CIT323007] [--refresh]

Course <-> module links come from the offer nodes ("Angebotsknoten") of each module page
(handbook.offer_courses). The REST search by module id / name (rest.match_course) is only a
cross-check; differences go to scrape_log (step "crosscheck"). Courses attached to the SPO
curriculum (curriculumVersionId filter) that no module offers are stored without module link.
"""
import argparse

from tum import db, handbook, rest

SPO_NR = 5455      # 16 042 Bioinformatics (20261, Master's); also the curriculumVersionId
TERM_ID = 207      # WS 2026/27
TERM_KEY = "26W"


def term_status(turnus, n_courses):
    if n_courses:
        return "offered"
    t = (turnus or "").lower()
    if "sommer" in t and "winter" not in t and "jedes" not in t:
        return "not_offered_turnus"
    return "not_offered_other"


def store_course(con, cid, in_curriculum, refresh):
    d = rest.course_detail(cid, refresh)
    con.execute("INSERT OR REPLACE INTO course(course_id,type,title,semester,reg_open,reg_status,reg_info,"
                "course_url,registration_url,in_curriculum,language) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
                (cid, d["type"], d["title"], d["semester"], d["reg_open"], d["reg_status"], d["reg_info"],
                 d["course_url"], d["registration_url"], int(in_curriculum), d["language"]))
    con.execute("DELETE FROM lecturer WHERE course_id=?", (cid,))
    for l in rest.course_lecturers(cid, refresh):
        con.execute("INSERT INTO lecturer VALUES(?,?,?,?)", (cid, l["person_id"], l["name"], l["role"]))
    con.execute("DELETE FROM course_group WHERE course_id=?", (cid,))
    con.executemany("INSERT OR IGNORE INTO course_group VALUES(?,?)",
                    [(cid, g) for g in rest.course_group_names(cid, refresh)])
    con.execute("DELETE FROM slot WHERE course_id=?", (cid,))
    slots = rest.course_slots(cid, refresh)
    if not slots:
        db.log(con, "slots", str(cid), f"no dates ({d['title']})")
    for s in slots:
        con.execute("INSERT INTO slot(course_id,group_name,weekday,start_time,end_time,first_date,last_date,room,n_dates)"
                    " VALUES(?,?,?,?,?,?,?,?,?)",
                    (cid, s["group_name"], s["weekday"], s["start_time"], s["end_time"],
                     s["first_date"], s["last_date"], s["room"], s["n_dates"]))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--module")
    ap.add_argument("--refresh", action="store_true")
    args = ap.parse_args()

    con = db.connect()
    modules = handbook.list_modules(SPO_NR, args.module or "", args.refresh)
    print(f"{len(modules)} modules")
    cur = {c["course_id"]: c for c in rest.curriculum_courses(SPO_NR, TERM_ID, args.refresh)}
    print(f"{len(cur)} courses attached to curriculum {SPO_NR}")

    links = {}                      # (module_id, course_id) -> offer-node evidence
    guesses = {}                    # (module_id, course_id) -> 'id' | 'name'  (cross-check only)
    seen_modules = {}
    for m in modules:
        mid = m["module_id"]
        try:
            det = handbook.module_details(m["knoten_nr"], args.refresh)
            offered = [c for c in handbook.offer_courses(m["knoten_nr"], args.refresh) if c["semester"] == TERM_KEY]
            for c in offered:
                links[(mid, c["course_id"])] = c
            pool = {c["course_id"]: c for c in rest.search_candidates(mid, m["name"], TERM_ID, args.refresh)}
            pool.update(cur)
            for c in pool.values():
                method = rest.match_course(c, mid, m["name"])
                if method:
                    guesses[(mid, c["course_id"])] = method
            seen_modules[mid] = (m, det, len({c["course_id"] for c in offered}))
        except Exception as e:  # keep crawling
            db.log(con, "module", mid, f"{type(e).__name__}: {e}")

    for key in sorted(set(guesses) - set(links)):
        db.log(con, "crosscheck", f"{key[0]}/{key[1]}", f"heuristic ({guesses[key]}) link not in offer nodes")
    for key in sorted(set(links) - set(guesses)):
        db.log(con, "crosscheck", f"{key[0]}/{key[1]}", "offer-node link not found by heuristics")

    linked = {cid for _, cid in links}
    con.executemany("DELETE FROM module_course WHERE module_id=?", [(mid,) for mid in seen_modules])
    for cid in linked | (set(cur) if not args.module else set()):
        try:
            store_course(con, cid, cid in cur, args.refresh)
            con.commit()
        except Exception as e:
            db.log(con, "course", str(cid), f"{type(e).__name__}: {e}")
    for (mid, cid), c in links.items():
        con.execute("INSERT OR REPLACE INTO module_course(module_id,course_id,method,node_nr,node_name,row_text)"
                    " VALUES(?,?,?,?,?,?)", (mid, cid, "offer", c["node"], c["node_name"], c["text"]))
    for mid, (m, det, n) in seen_modules.items():
        con.execute("INSERT OR REPLACE INTO module VALUES(?,?,?,?,?,?,?,?,?,?)",
                    (mid, m["name"], m["knoten_nr"], m["org_id"], SPO_NR, det["ects"], det["turnus"],
                     term_status(det["turnus"], n), handbook.module_url(m["knoten_nr"]), "|".join(det["catalogs"])))
    con.commit()


if __name__ == "__main__":
    main()
