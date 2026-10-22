# Plan: local lecture database for SPO "16 042 Bioinformatics (20261, Master's)"

## Goal

Local SQLite database with, for every module in the SPO and every course (lecture and exercise) offered in the target semester:

- module id and name
- course id, type (VO/UE/...), title
- weekday, start/end time, date range, room, per group
- whether registration is possible, with a link to the registration page

Target semester: **WS 2026/27** (`termId=207`, key `26W`). Configurable by one constant.

## What was verified (example CIT323007)

| Need | Source | Notes |
|---|---|---|
| SPO internal id | select2 dropdown in Module Handbook, tab "Modules in Curriculums" | "16 042 Bioinformatics (20261, Master's program, current)" -> `pStpStpNr=5455` |
| Module list | `GET /tumonline/WBMODHB.cbShowMHBListe?pCaller=tabIdSPOModules&pOrgNr=1&pSort=&pFilter=&pStpStpNr=5455&pFilterNameOrKennung=&pFilterSemesterNr=207&pPageNr=N` | Server-rendered HTML, no login, works with plain `requests`. 6 pages with semester filter 207. |
| Module page | `WBMODHB.wbShowMHBReadOnly?pKnotenNr=<knoten>&pOrgNr=1` | `pKnotenNr` comes from the list rows (CIT323007 -> 4860420). |
| Course ids | `GET /tumonline/ee/rest/slc.tm.cp/student/courses?$filter=courseNormKey-eq=LVEAB;filterTerm-like=<MODULE_ID>;orgId-eq=1;termId-eq=207&$orderBy=title=ascnf&$skip=0&$top=20` with `Accept: application/json` | Returns VO and UE (951006995, 951006996). |
| Course detail | `GET /tumonline/ee/rest/slc.tm.cp/student/courses/{id}?$ctx=lang=en` | Title, type, semester, `registrationAvailable`, `registrationInfoStatus`. |
| Groups and times | `GET /tumonline/ee/rest/slc.tm.cp/student/courseGroups/firstGroups/{id}?$ctx=lang=en` | `courseGroupDtos[].appointmentSeriesDtos[]`: weekday, `seriesBeginTime`, `seriesEndTime`, `seriesBegin`, `seriesEnd`, `resourceName`. |
| Registration link | `https://campus.tum.de/tumonline/ee/ui/ca2/app/desktop/#/slc.tm.cp/student/courses/{id}/registrationProcedures` | Target of the REST redirect `.../rest/pages/slc.tm.cp/course-registration/{id}`. |
| Course page link | `https://campus.tum.de/tumonline/ee/ui/ca2/app/desktop/#/slc.tm.cp/student/courses/{id}` | |

Example result: lecture 951006995 is Tuesday 14:00-16:00, 2026-10-13 to 2027-02-02, Hoersaal 1 Garching, registration RUNNING. The exercise 951006996 has many groups (Group 1 Tuesday 16:00-18:00, Group 10 Friday 13:00-15:00, ...).

The REST API is internal to the TUMonline frontend. It was found by logging network calls of the page in headless Chrome. It is undocumented and can change without notice.

Not usable: the offer-node expand in the module page (`wbStpCS.cbShowGHKs_new`) returned 404 in headless Chrome, so course ids come from the REST search instead.

## Decisions (confirmed)

- Target semester: WS 2026/27 only.
- Exercises (UE) are separate courses and separate rows, one row per group.
- Modules with no course in WS 26/27 are kept and marked by their **Turnus** (offering cycle, read from the module page, field "Turnus", e.g. `Wintersemester`; CIT323007 shows "Turnus Wintersemester"). Status values in `module.term_status`:
  - `offered`: at least one course found in WS 26/27.
  - `not_offered_turnus`: no course, and the Turnus says the module is not given in a winter semester (e.g. `Sommersemester`).
  - `not_offered_other`: no course, but the Turnus says it should be (winter semester, every semester, unknown or irregular). Flags a possible data gap, to be looked at manually.

## Open points to verify while building

1. **Module id matching.** `filterTerm-like` matched CIT323007. Ids such as `IN2379`, `WZ2620 ver2018`, `SOT86062` are untested. A short id could match other courses (substring match), so results must be filtered by course number (see step 3).
2. **Pagination of the SPO list without the semester filter.** The 6 pages were seen with `pFilterSemesterNr=207`. Check what the unfiltered list returns and whether modules not offered in WS 26/27 should still appear (with no courses).
3. **Turnus values.** Only "Wintersemester" has been seen. Collect all distinct values on the first full run and map them (Winter / Sommer / every semester / on demand) to `term_status`. Unknown values go to `not_offered_other` and are logged. Also several courses of the same type (split lectures) must produce rows, not errors.
4. **Courses without dates** (`appointmentSeriesDtos` empty, e.g. "by arrangement"). Keep the course with no slot rows.
5. **`$top=20` limit** on course search. Page with `$skip` until fewer than `$top` results.
6. **Row `numbers`:** the course number in JSON is `0CIT323007` (leading `0`); module id is `CIT323007`. Match by `endswith` or stripped prefix, and log mismatches.

## Architecture

Plain Python 3 with `requests`, `beautifulsoup4`/`lxml`, `sqlite3`. No browser needed at run time (Playwright was only used for discovery).

```
stundenplan/
  plan_data_scraper.md
  scrape.py          # CLI entry: crawl all steps, resumable
  tum/
    handbook.py      # SPO module list parsing
    rest.py          # course search, course detail, groups
    db.py            # schema + upserts
  raw/               # cached raw responses (html/json) by key
  stundenplan.db
  query.py           # simple queries and CSV export
  scrape.log
```

### Steps

1. **Constants.** `SPO_NR=5455`, `TERM_ID=207`, base URLs, `Accept: application/json` for REST, a descriptive User-Agent.
2. **Module list.** Fetch `cbShowMHBListe` for `pPageNr=1..N` (N read from the page navigation). Parse each row: name, module id (Kennung), version, org id, `pKnotenNr` from the row link. Store in `module`. Cache each page under `raw/modules/`.
2b. **Module page.** Fetch `wbShowMHBReadOnly?pKnotenNr=...` per module (plain `requests`, German page). Parse "Turnus" and "Moduldauer", plus ECTS ("ECTS-Credits"). Cache under `raw/module_pages/`.
3. **Course search per module.** For each module id, call the course search (term 207), paginate. Keep only results whose course number ends with the module id (after stripping the leading `0`). Record course id, type, title. Cache JSON under `raw/search/`.
4. **Course detail per course id.** Fetch `courses/{id}`. Store semester, type, `registrationAvailable`, `registrationInfoStatus`, build `course_url` and `registration_url`. Cache.
5. **Groups per course id.** Fetch `courseGroups/firstGroups/{id}`. For each group and each `appointmentSeriesDtos` entry, store one row in `slot`: group name, weekday, start, end, first date, last date, room. Cache.
6. **Logging.** Every request failure or parse anomaly goes into `scrape_log(step, key, message)`. Retry with exponential backoff (3 tries). The crawl continues after errors.
7. **Resume.** Each step skips keys that exist in the cache or DB unless `--refresh` is passed.
8. **Politeness.** Sequential requests, 0.5-1 s sleep between them, single connection. Roughly 3 requests per module, so the full run is a few hundred requests.

### Database schema

```sql
module(
  module_id TEXT PRIMARY KEY,   -- e.g. CIT323007
  name TEXT,
  knoten_nr INTEGER,            -- handbook pKnotenNr
  org_id TEXT,
  spo_nr INTEGER,               -- 5455
  ects INTEGER,
  turnus TEXT,                  -- raw handbook value, e.g. Wintersemester
  term_status TEXT              -- offered | not_offered_turnus | not_offered_other
);

course(
  course_id INTEGER PRIMARY KEY,   -- e.g. 951006995
  module_id TEXT REFERENCES module,
  type TEXT,                       -- VO, UE, ...
  title TEXT,
  semester TEXT,                   -- 26W
  reg_available INTEGER,           -- 0/1
  reg_status TEXT,                 -- RUNNING, ...
  course_url TEXT,
  registration_url TEXT
);

slot(
  id INTEGER PRIMARY KEY,
  course_id INTEGER REFERENCES course,
  group_name TEXT,
  weekday TEXT,                    -- Dienstag / Tuesday
  start_time TEXT,                 -- 14:00
  end_time TEXT,                   -- 16:00
  first_date TEXT,
  last_date TEXT,
  room TEXT
);

scrape_log(ts TEXT, step TEXT, key TEXT, message TEXT);
```

Modules without a course in the term keep their `module` row (with `turnus` and `term_status`) and have no `course` rows. Courses without dates have no `slot` rows. Nothing is dropped silently.

## Validation

1. Run the crawl for CIT323007 only (`scrape.py --module CIT323007`) and compare with the website: lecture Tuesday 14:00-16:00, registration open, exercise groups present.
2. Run the full SPO. Check counts: modules in DB equals number of rows in the handbook list; every module either has courses or a log entry.
3. Spot-check 5 more modules by hand on the website: one with several groups, one without dates, one with registration closed, one with a non-`IN` id (e.g. `WZ...`), one whose id is a substring of another.
4. Re-run to confirm resume works (no refetch, same counts).

## Output

- `stundenplan.db` (SQLite).
- `query.py` with:
  - list all lectures/exercises by weekday and time
  - filter to registration open
  - CSV export (module id, name, course type, weekday, time, registration yes/no, link)
- Later, optional: time-conflict check when choosing a set of electives.

## Remaining assumptions

- `query.py` shows `not_offered_*` modules in a separate section, not mixed with schedulable courses.

## Verification results and changes (2026-10-17)

Checks run after the first full crawl, and what they changed:

1. **Course search by module id alone was incomplete.** A cross-check by module name and a course list filtered by curriculum (`curriculumVersionId-eq=5455`, 128 courses in WS 26/27) showed courses missed: ids in `[...]` brackets, Praktika, all language courses (title has no module id), exercises whose title has no id.
   - Now: candidates = id search + name search + curriculum list. `rest.match_course` links a course to a module by id token in `(...)`/`[...]` or number, or exact normalized title equal to the module name (never when the title names other module ids).
   - Courses in the curriculum list that match no module are stored unlinked and listed by `query.py` with a fuzzy module hint for manual review (15 courses).
   - Course-module links are now a table `module_course(module_id, course_id, method)`; one course can serve two modules.
2. **`firstGroups` returns only 5 groups.** `remainingGroups/{id}` has the rest (CIT323007 exercise: 16 groups). Both are fetched when `totalCount` > returned.
3. **Slots are built from individual appointments**, not series. Shared dates (e.g. the Monday central exercise of CIT323007, listed in every group, not in any series) appear once as group `(shared)`.
4. **Registration state.** `registrationAvailable=True` only means a procedure exists. The state is `registrationInfoStatus`: `RUNNING` (open), `NONE` ("Anmeldung abgelaufen"), `INFO` (no procedure). `course.reg_open` = RUNNING; `reg_info` keeps the text; `registration_url` is set only when a procedure exists. Verified against the UI banner ("Course open for registration" / "Registration expired").
5. **Turnus parser** fixed for pages with an empty Turnus field.
6. **Verified against the live UI:** Machine Learning (Mon 10-12, Tue 12-14, Wed 16-19) and Data Regulation & Law (Mon 11:30-13:00).
7. **Idempotency:** a second full run from the cache gives identical row counts.

Known limits:
- The module page's offer-node expand returns 404 in headless Chrome, so the module-to-course link is inferred, not read from the handbook. Courses attached to a module only by a differently worded title (e.g. "Molekulare Onkologie I" vs module "Molekulare Onkologie") stay unlinked until reviewed.
- The curriculum list holds only courses linked at course level; 6 courses (Machine Learning, NLP, AI in Medicine, ...) were found by id only.
- Courses without published dates have no slot rows (3 in WS 26/27, logged in `scrape_log`).
- The REST API is undocumented and may change.

## Source documents (2026-10-18)

- TUM module handbook: https://campus.tum.de/tumonline/WBMODHB.wbShow?pOrgNr=1 (module pages and the SPO module list are read from here).
- FPSO Bioinformatics M.Sc. (23.07.2026): https://www.tum.de/fileadmin/w00bfo/www/Studium/Studienangebot/Lesbare_Fassung/Master/Bioinformatik_MA_FPSO_23072026.pdf (catalog and credit source with top priority, `data/fpso_modulkatalog.pdf`).
- Modulkatalog (CIT website; since 2026-10-21 it has an FPSO 2026 section, the 2021 section stays below it): https://www.cit.tum.de/cit/studium/studiengaenge/master-bioinformatik/modulkatalog/

All three are also linked in the app footer (see `plan_web_app.md`).

## Cleanup check (2026-10-20)

- **`raw/pos/` (230 MB, 132 files) is not part of the pipeline.** The cache kinds the code uses are `catalog, course, curriculum, groups, groups_rest, module_pages, modules, offers, search, xname`; no code (`scrape.py`, `tum/`, `build_catalog.py`, `export_data.py`, `query.py`) writes or reads `pos`. The files are raw curriculum-position JSON from the exploration phase (last written 2026-10-17 21:00, before the curriculum-list approach replaced it). Test: copy of the project without `raw/pos`, rerun `scrape.py` (no network call, no new files), `build_catalog.py`, `export_data.py`: `schedule.json` identical to the current one (except `generated`). Safe to delete; not listed in this plan.
- **`query.py` stays.** It is a listed deliverable (Output section) and still runs on the current schema. The web app does not replace all of it: the review lists (courses without module link with fuzzy hints, modules not offered in WS 26/27 with their Turnus) and the CSV export exist only there. Only the schedule listing is superseded by the app.
- Plan files renamed: `plan.md` -> `plan_data_scraper.md` (scraper and database), `plan_schedule.md` -> `plan_web_app.md` (web app); references updated.

## Update: CIT website now follows FPSO 2026 (2026-10-21)

The Modulkatalog page now starts with an "FPSO 2026" section (compulsory table, then the four elective tables), followed by the unchanged "FPSO 2021" section. Checked against the cached copy of 2026-10-18 (which only had the 2021 tables):
- `tum/catalog.py: parse_web` reads tables 1 to 4 of the page, which are now the 2026 tables (methods, cs, bio, and the previously unparsed Überfachliche Grundlagen table), so a `build_catalog.py --refresh` was enough; the 2021 tables are ignored. The parser depends on the table order of the page.
- Website modules: 79 (2021) -> 77 (2026, including 10 interdisciplinary modules).
- The website now agrees with the regulation PDF on every shared module, for catalog and credits. The website credit conflicts of CIT4230001, IN2361 and WZ2439 are gone; only the handbook still says 5 credits for **WZ2439** (PDF and website: 6).
- CIT323007 is now listed by the website (Informatik, Mathematik und Statistik, 6 credits), confirming what was taken from the handbook. It is still not in the PDF.
- New disagreement: **IN5128** Einführung in Computational Neuroscience: website says Informatik/Mathematik/Statistik, handbook says Biologie/Biochemie/Chemie, not in the PDF. Currently `bio` (precedence rule PDF > handbook > website).
- 7 modules that are in a handbook catalog but in neither PDF nor 2026 website (they were on the 2021 website): IN2031, IN2080, IN5026, IN5030, IN5056, WZ2170, WZ2381. Their catalog comes from the handbook only; they may have been dropped from the catalogs in 2026.
- Not in the SPO 20261 module list (no courses can be shown): CH0156, CIT423014, CIT423019, CIT802000, IN5176.
- `data/catalog_report.md` and `data/modulkatalog.json` regenerated.

**Open decision:** the precedence rule (PDF > handbook > website) was set when the website still showed the 2021 rules. With the website on 2026 it could rank above the handbook; this only changes IN5128 (`bio` -> `cs`) and the 7 handbook-only modules stay as they are. Not changed.

## Note: where the handbook names the catalog (2026-10-21)

The catalog of a module is only in a **hover tooltip** (info icon after the `20261` row of "Zuordnungen zu SPO-Versionen" on the module page; hidden `overlayTTContainer` in the HTML). Checked for better places, none found: the SPO module list (`cbShowMHBListe`) has no catalog column, `showSpoTree` is not public ("Details ... im Studiensekretariat"), and the course page's curriculum positions (`.../slc.cm.curriculumposition/positions/{id}/course/allCurriculumPositions`) do not contain the Master 20261 curriculum for the tested courses. So the handbook is the weakest evidence; the app calls it "TUMonline website" and shows it next to the other sources (see `plan_web_app.md`).

## Correction: handbook pages were stale (2026-10-21)

The earlier section "Update: CIT website now follows FPSO 2026" compared the new website with **handbook pages cached on 2026-10-17**, and the handbook had changed since. Live check of IN5128 (module page `pKnotenNr=952415`): the `[20261]` tooltip now names *Wahlmodulkatalog Theorie Informatik, Mathematik und Statistik*, the cached page said *Biologie/Biochemie/Chemie*. All 257 module pages were refetched (`handbook.module_details(k, refresh=True)`, 0 failures), then `scrape.py` (rest from cache), `build_catalog.py`, `export_data.py` were rerun.

Result:
- **No catalog disagreement left.** IN5128 is `cs` in handbook and website (the "new disagreement" and the open precedence question of that section are void). IN5187 now has one handbook catalog (interdisc) and agrees with PDF and website.
- The only remaining difference between sources is credits of **WZ2439** (handbook 5, PDF and website 6; module not offered in WS 26/27).
- Handbook modules with a catalog path: 255 -> 248. The 7 modules that had *only* a handbook catalog (IN2031, IN2080, IN5026, IN5030, IN5056, WZ2170, WZ2381) lost their `[20261]` catalog path: they are no longer in any elective catalog, matching PDF and website. None of them has a catalog now ("handbook only" list is empty).
- Effect on lectures: lecture **Proteomics (WZ2170, course 950940568)** has no catalog any more (grey, counts no credits). It is linked to WZ2170 by the handbook's offer node; its successor WZ2439 (same title, in the PDF as `bio`, 6 credits) is not offered in WS 26/27. To be checked by hand whether the lecture counts for WZ2439. Lectures per catalog: bio 6, methods 7, cs 10, interdisc 1, none 2.
- **Cache age:** the handbook changes, so `raw/module_pages/` must be refreshed before each export that is published. `scrape.py --refresh` does it (together with all other steps).

## Full refresh (2026-10-21)

`scrape.py --refresh` (all steps refetched), then `build_catalog.py` and `export_data.py`.
- **Course set unchanged:** 135 courses in the DB before and after (same ids, 2 unlinked), 26 lectures, 124 courses + 11 exercises in `schedule.json`. The live curriculum list now returns 135 courses (128 on 2026-10-17); the 7 extra ones were already in the DB through the id/name search, so nothing new appeared. (An earlier remark that "at least 7 courses were added" was wrong.)
- **Changes in existing courses:** two lectures got their dates: *Fortgeschrittene Datenverarbeitungs- und Visualisierungstechniken* (IN2379, Friday 10-12) and *Protein Prediction II for Bioinformaticians* (IN2230, Tuesday 16-18 and Thursday 14-16); courses without dates 8 -> 7. Registration of *Künstliche Intelligenz in der Medizin I* and both *Multiomics Profiling for Microbiome Data* courses changed from open (RUNNING) to expired. Eight language courses and *Data Ethics in Practice* changed their slots.
- Unit tests 25 and e2e pass on the new data.
- Lesson: slots and registration states change during the first semester weeks, so the crawl must be repeated before publishing (see the update note in `plan_web_app.md`).
