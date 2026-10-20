"""Print the schedule and export CSV.  Usage: python3 query.py [--open] [--csv out.csv]"""
import argparse
import csv
import difflib
import sqlite3
import sys

from tum.db import DB_PATH
from tum.rest import base_title

ap = argparse.ArgumentParser()
ap.add_argument("--open", action="store_true", help="only courses with registration currently open")
ap.add_argument("--csv")
args = ap.parse_args()

con = sqlite3.connect(DB_PATH)
where = "WHERE c.reg_open=1" if args.open else ""
rows = con.execute(f"""
SELECT mc.module_id, m.name, c.type, c.title, s.group_name, s.weekday, s.start_time, s.end_time,
       s.n_dates, s.room, CASE c.reg_open WHEN 1 THEN 'open' ELSE 'closed' END, c.reg_info,
       c.registration_url, c.course_url, mc.method
FROM course c LEFT JOIN module_course mc USING(course_id) LEFT JOIN module m ON m.module_id=mc.module_id
LEFT JOIN slot s USING(course_id) {where}
ORDER BY COALESCE(mc.module_id,'~'), c.type DESC, c.course_id, s.group_name""").fetchall()
head = ["module_id", "module", "type", "course", "group", "weekday", "start", "end", "n_dates", "room",
        "registration", "reg_info", "registration_url", "course_url", "match"]
if args.csv:
    with open(args.csv, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(head)
        w.writerows(rows)

w = csv.writer(sys.stdout, delimiter="\t")
print("-- Schedule WS 26/27 (module, type, group, time, registration)")
for r in rows:
    if r[0]:
        w.writerow([r[0], r[2], r[4] or "-", f"{r[5] or '-'} {r[6] or ''}-{r[7] or ''}", f"reg:{r[10]}"])

print("\n-- Courses in the SPO without a module link (check manually; best fuzzy module name)")
modules = con.execute("SELECT module_id, name FROM module").fetchall()
for cid, typ, title in con.execute(
        "SELECT course_id, type, title FROM course WHERE course_id NOT IN (SELECT course_id FROM module_course)"):
    best = max(modules, key=lambda m: difflib.SequenceMatcher(None, base_title(title), base_title(m[1])).ratio())
    ratio = difflib.SequenceMatcher(None, base_title(title), base_title(best[1])).ratio()
    hint = f"~ {best[0]} {best[1]} ({ratio:.2f})" if ratio >= 0.6 else ""
    print(f"{cid}\t{typ}\t{title}\t{hint}")

print("\n-- Modules without a course in WS 26/27")
for status, mid, name, turnus in con.execute(
        "SELECT term_status, module_id, name, COALESCE(turnus,'?') FROM module WHERE term_status!='offered' ORDER BY term_status, module_id"):
    print(f"{status}\t{mid}\t{name}\t[{turnus}]")
