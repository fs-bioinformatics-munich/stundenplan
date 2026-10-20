import sqlite3
from pathlib import Path

DB_PATH = Path(__file__).resolve().parent.parent / "stundenplan.db"

SCHEMA = """
CREATE TABLE IF NOT EXISTS module(
  module_id TEXT PRIMARY KEY, name TEXT, knoten_nr INTEGER, org_id TEXT, spo_nr INTEGER,
  ects INTEGER, turnus TEXT, term_status TEXT, module_url TEXT, catalogs TEXT);
CREATE TABLE IF NOT EXISTS course(
  course_id INTEGER PRIMARY KEY, type TEXT, title TEXT, semester TEXT, reg_open INTEGER,
  reg_status TEXT, reg_info TEXT, course_url TEXT, registration_url TEXT, in_curriculum INTEGER);
CREATE TABLE IF NOT EXISTS module_course(
  module_id TEXT REFERENCES module, course_id INTEGER REFERENCES course, method TEXT,
  node_nr INTEGER, node_name TEXT, row_text TEXT,
  PRIMARY KEY(module_id, course_id));
CREATE TABLE IF NOT EXISTS slot(
  id INTEGER PRIMARY KEY, course_id INTEGER REFERENCES course, group_name TEXT, weekday TEXT,
  start_time TEXT, end_time TEXT, first_date TEXT, last_date TEXT, room TEXT, n_dates INTEGER);
CREATE TABLE IF NOT EXISTS lecturer(
  course_id INTEGER REFERENCES course, person_id INTEGER, name TEXT, role TEXT,
  PRIMARY KEY(course_id, person_id));
CREATE TABLE IF NOT EXISTS course_group(
  course_id INTEGER REFERENCES course, group_name TEXT, PRIMARY KEY(course_id, group_name));
CREATE TABLE IF NOT EXISTS scrape_log(ts TEXT DEFAULT CURRENT_TIMESTAMP, step TEXT, key TEXT, message TEXT);
"""


MIGRATIONS = [("module", "module_url", "TEXT"), ("module_course", "node_nr", "INTEGER"),
              ("module_course", "node_name", "TEXT"), ("module_course", "row_text", "TEXT"), ("course", "language", "TEXT"), ("module", "catalogs", "TEXT")]


def connect():
    con = sqlite3.connect(DB_PATH)
    con.executescript(SCHEMA)
    for table, col, typ in MIGRATIONS:      # databases created before these columns existed
        if col not in [r[1] for r in con.execute(f"PRAGMA table_info({table})")]:
            con.execute(f"ALTER TABLE {table} ADD COLUMN {col} {typ}")
    return con


def log(con, step, key, message):
    print(f"[{step}] {key}: {message}")
    con.execute("INSERT INTO scrape_log(step,key,message) VALUES(?,?,?)", (step, key, message))
