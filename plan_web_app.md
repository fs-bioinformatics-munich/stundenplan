# Plan: visual scheduler for the WS 26/27 lecture database

## Goal

A graphical weekly view on top of `stundenplan.db` (see `plan_data_scraper.md`):

1. **Main view:** weekdays Monday to Friday as columns, a time axis, **lectures** as boxes (other course types can be switched on with filter checkboxes, see below). Overlapping lectures sit side by side; the day area scrolls horizontally when it gets crowded. Clicking a box opens a popup (lecturers, dates, room, registration link, module description link).
2. **Selection:** every box has a checkbox in its top right corner. A **Create schedule** button opens the schedule view with the selected lectures only.
3. **Schedule view:** the same grid with the selected lectures. A **Show exercises** button adds all exercise slots of those lectures. Picking one exercise group greys out all other groups of the same lecture's exercise.
4. **Design principle:** the app must be embeddable later in an Astro site on GitHub Pages. So: static files only, no server, no database access in the browser, no calls to TUMonline from the browser.

## Facts from the database that shape the design

(Measured on the current `stundenplan.db`, 135 courses.)

| Fact | Consequence |
|---|---|
| Course types: VO 21, VI 5 (lecture with integrated exercise), UE 11, SE 94 (mostly language courses), PR 2, FO 1, WS 1 | "Lecture" = type `VO` or `VI`, shown by default. Other types (seminar, practical, research, workshop) are off by default and can be switched on with type filter checkboxes. Language courses (module organisation `TUZEIO2`, the language centre) get their own checkbox, because they are most of the 94 `SE` rows and would flood the grid. Exercises (`UE`) are not part of the main grid; they appear only in the schedule view. |
| 24 of the 26 lectures have dates; 38 lecture slot rows over Monday to Friday | The grid needs Monday to Friday only. Lectures without dates go into a separate "no dates yet" list so they are not lost. |
| A lecture often has 2 slots a week (e.g. Mon 10-12 and Tue 12-14) | One course = several boxes. The checkbox state belongs to the course, so ticking one box ticks all boxes of that course. |
| Slot = weekday + time + `n_dates` between `first_date` and `last_date` (1 to 30 dates) | Draw it as a weekly slot. If `n_dates` is small (say under 5) mark it "irregular / few dates" in the box and show the actual date range in the popup. Single dates are not drawn on a calendar. |
| Exercises (UE) link to lectures through the module (`module_course`): 10 linked UE courses, all of them have a lecture in the same module. Only one module has two lectures. | Exercise to lecture mapping = same `module_id`. For the one ambiguous module, show the exercise under each of its lectures or match by title and flag it. |
| Exercise groups: `Group 1`, `Group 10`, ..., up to 4 groups with dates per course (the CIT323007 exercise has 16 groups but only 3 with dates), plus a `(shared)` slot that belongs to all groups | A pick is a (course, group). The `(shared)` slot is fixed: it is always shown with the exercise, never selectable and never greyed. Groups without dates are listed as "no dates yet" and cannot be picked. |
| Registration: `reg_open` (RUNNING), `reg_info` text, `registration_url` only when a procedure exists | Boxes get a small status dot (open / closed). The popup shows a registration link only when a URL exists. |
| The database has no lecturers, language or course page for the popup yet; `module.module_url` and `ects` exist | Add lecturers (see "Data additions"). The raw course JSON is already cached in `raw/course/`, so this needs no new requests. |

## Architecture

```
stundenplan/                     (existing scraper, unchanged except data additions)
  export_data.py                 NEW  stundenplan.db -> app/public/data/schedule.json
app/                             NEW  static front end
  public/data/schedule.json      generated data, the only interface to the scraper
  src/
    lib/
      types.ts                   Course, Slot, ExerciseGroup, Selection
      layout.ts                  overlap lane assignment (pure function)
      selection.ts               selection and exercise-pick state, grey-out rules, conflict check
      store.ts                   state + persistence (localStorage, URL hash)
    components/
      WeekGrid.*                 time axis, day columns, boxes (used by both views)
      CourseBox.*                one box with checkbox
      CoursePopup.*              details popup
      MainView.*                 filters, grid, "Create schedule" button
      ScheduleView.*             grid of selection, "Show exercises", summary panel
    pages/ (or App.*)            routing between the two views
  tests/                         unit tests (layout, selection), end to end smoke test
```

### Why static JSON, not a live API

- GitHub Pages and Astro serve files only. The scraper runs offline (or in a scheduled GitHub Action later) and writes one JSON file; the app only reads it.
- Calling TUMonline from the browser would hit CORS and depend on an undocumented, changeable API.
- The JSON also acts as the contract: if the schema changes, `export_data.py` and one TypeScript type change, nothing else.

### Stack (Astro-ready)

- **TypeScript + Preact, built with Vite**, as small self-contained components with props in and callbacks out, no global CSS frameworks. Preact components drop into Astro unchanged as islands (`client:load`).
- Plain CSS with custom properties (light/dark), CSS grid for the day columns.
- Build config reads a `BASE_URL` so assets work under `https://<user>.github.io/<repo>/`.
- State lives in the browser only: `localStorage` for selection and exercise picks, plus an optional URL hash (`#l=951006995,950942367&e=951006996:Group 10`) so a plan can be shared and survives reloads. `localStorage` access is wrapped in try/catch because it can be unavailable (private mode).
- No dependencies for layout or time axis; the grid is computed in `layout.ts` and tested separately.

## Data model (JSON)

`schedule.json`, generated by `export_data.py`:

```jsonc
{
  "term": "WS 2026/27", "generated": "2026-10-17T22:40:00",
  "modules": { "CIT323007": { "name": "...", "ects": 6, "url": "<handbook module page>", "turnus": "Wintersemester" } },
  "courses": [{                      // all non-exercise courses; the UI filters by type/category
    "id": 951006995, "module": "CIT323007", "type": "VO", "category": "lecture", "title": "...",
    "lecturers": [{"name": "Julien Gagneur", "role": "Head"}, ...],
    "language": "English",
    "registration": {"open": true, "info": "LV-Anmeldung möglich", "url": "<registrationProcedures link>"},
    "course_url": "<course page>",
    "slots": [{"day": 2, "start": "14:00", "end": "16:00", "room": "...", "first": "2026-10-13", "last": "2027-02-02", "n": 15}]
  }],
  "exercises": [{
    "id": 951006996, "lecture_ids": [951006995], "module": "CIT323007", "title": "...",
    "registration": {...}, "course_url": "...",
    "fixed_slots": [ { shared slot ... } ],
    "groups": [{"name": "Group 10", "slots": [ ... ]}, {"name": "Group 2", "slots": []}]
  }],
  "no_dates": [ course ids without slots, shown in a side list ]
}
```

Weekday is stored as number (1 = Monday) so the app does not depend on German weekday names. Times are `HH:MM` strings; the app converts to minutes.

## Data additions to the scraper (small)

1. New table `lecturer(course_id, name, role)` and column `course.language`, filled in `store_course` from the already cached `raw/course/*.json` (`lectureships[].identityLibDto` + `teachingFunction`, `courseLanguageDtos`). Roles: "Leiter*in" = head, "Vortragende*r" = lecturer.
2. `export_data.py`:
   - `courses` = all courses linked to a module except type `UE`; `category` = `lecture` (`VO`/`VI`), `seminar` (`SE`), `practical` (`PR`), `research` (`FO`), `workshop` (`WS`), or `language` when the module's organisation is `TUZEIO2` (checked on export: unknown types fail the export instead of being guessed);
   - courses attached to no module (the two unlinked curriculum courses) are exported with `module: null` and still shown;
   - exercises = type `UE`, attached to lectures of the same module (`lecture_ids`);
   - weekday names to numbers; group `(shared)` goes to `fixed_slots`;
   - groups without dates are kept (empty `slots`);
   - checks: ids unique, referenced ids exist, every type maps to a category; fails loudly otherwise.

## UI design

### Main view

- Header: title, search box (title / module id / lecturer), filter "registration open", counter "N selected", **Create schedule** button (disabled when nothing is selected).
- **Type filter checkboxes** (row under the header, each with a count): `Lectures (VO, VI)` checked by default; unchecked by default: `Seminars (SE)`, `Practicals (PR)`, `Research (FO)`, `Workshops (WS)`, `Language courses`. Switching a type on adds its boxes to the grid immediately; box tint and a small type badge distinguish the types. The filter state is remembered like the selection. Selected courses stay selected when their type is switched off (the counter shows them and the schedule view still includes them).
- Grid: columns Monday to Friday, sticky day header, time axis on the left (range derived from the data, rounded to full hours, e.g. 08:00 to 20:00), hour lines.
- Box: position by start time, height by duration (fixed pixels per minute). Contents: title, time, module id, type badge, registration dot. Checkbox in the top right corner.
- Overlap: lectures that overlap in time within a day are placed in lanes side by side (algorithm below). Lane width has a minimum (e.g. 160 px). If a day needs more lanes than fit, that day column grows and the whole grid scrolls horizontally (sticky time axis and day headers stay visible).
- Click on the box body: popup. Click on the checkbox: toggles selection and does not open the popup.
- "No dates yet" side list for lectures without slots, also selectable and clickable.

### Popup

Title, module id and name, type, ECTS, language, lecturers (head first), each slot (weekday, time, room, date range, number of dates, an "irregular" note if few dates), registration status text and a **registration link** (only if the course has a procedure), **module description link**, TUMonline course page link. Closes with Escape or a click outside. For a lecture: also a list of its exercise courses with the number of groups.

### Schedule view

- Opens with **Create schedule** and shows the selected lectures in the same grid component. A back button returns to the main view with the selection kept.
- Right-hand summary: selected lectures, ECTS sum, conflicts, lectures with exercises but no exercise group picked yet.
- **Show exercises** toggle: adds exercise group boxes (dashed outline, different tint) for all selected lectures. The `(shared)` slot of an exercise is drawn solid and fixed.
- Picking: click an exercise group box (or its checkbox) to choose it. Then:
  - all other groups of the same exercise course become grayed out (lower opacity, no pointer interaction, tooltip "group X already chosen");
  - clicking the chosen group again releases the choice and un-grays the others.
- Groups without dates are listed under the grid as "no dates yet" and cannot be chosen.
- Conflicts: overlapping chosen boxes get a red marker and are listed in the summary; overlap between a lecture and a not-yet-chosen exercise group is shown in a lighter tone ("would clash") so picking can avoid it.

### Overlap layout algorithm (`layout.ts`)

For each weekday, take the boxes sorted by start time. Build clusters of transitively overlapping boxes. Inside a cluster assign each box the first lane whose last box ended before it starts (greedy interval partitioning), so the number of lanes equals the maximum number of simultaneous boxes. Lane count is per cluster; the day column width is based on the largest cluster. Equal-width lanes inside a cluster. This function is pure (boxes in, lane and lane count out), so it is unit tested.

### Accessibility and responsive

Keyboard: boxes are focusable buttons, Space toggles the checkbox, Enter opens the popup, Escape closes it. Colors never carry meaning alone (registration status also as text/icon). Narrow screens: the grid keeps its horizontal scroll; the popup becomes a bottom sheet.

## Implementation steps

1. **M0 Data:** add `lecturer` table and `language`, write `export_data.py`, produce `schedule.json`; checks pass (counts match DB: 26 lectures, 24 with dates).
2. **M1 Project skeleton:** `app/` with Vite + Preact + TypeScript, types, load JSON, static build works under a base path.
3. **M2 Layout:** `layout.ts` with unit tests (no overlap, chain overlaps, identical times, touching intervals, 5 simultaneous).
4. **M3 Main view:** grid, boxes, lanes, horizontal scroll, popup, checkbox selection, search, registration filter and type/category filter checkboxes with counts.
5. **M4 Persistence and Create schedule:** selection in `localStorage` and URL hash, schedule view with selected lectures.
6. **M5 Exercises:** Show exercises toggle, group boxes, pick and grey-out rules (unit tested), fixed shared slot, conflict markers and summary panel.
7. **M6 Polish and tests:** keyboard support, dark mode, print/screenshot-friendly schedule, end to end test with Playwright.
8. **M7 (later) Astro embedding:** copy components into an Astro project, `client:load` islands, page route for the app, GitHub Action running scraper and export on a schedule.

## Testing

- **Unit:** type/category filtering (default only lectures, switching types on and off, selection kept when a type is hidden), lane assignment, exercise grey-out (pick, switch, release; sibling groups only; shared slot never greyed), conflict detection, time-to-pixel mapping.
- **Data:** `export_data.py` self-checks and a test comparing JSON counts with the database.
- **End to end (Playwright):** open the page, check only lectures are shown, switch on `Seminars` and see more boxes, tick two overlapping lectures, check they appear side by side; click Create schedule; click Show exercises; pick a group and assert the siblings are grayed; reload and assert the state is restored.
- **Manual check against the live site:** compare 3 lectures (slots, lecturers, registration state, links) with TUMonline.

## Risks and notes

- Slot data is weekly; holiday gaps and one-off dates are only summarised by `n_dates` and the date range.
- Lecturer names come from TUMonline as published; they can be incomplete early in the semester.
- The data is a snapshot of the crawl time (`generated`). The UI shows it; the app does not update it.
- Everything in the browser is client side, so there are no secrets or personal data in the build.

## Decisions (confirmed)

1. Lectures are `VO` and `VI`. Other types (seminars, practicals, research, workshops, language courses) are available through filter checkboxes, off by default.
2. In-page views and popups instead of real browser windows; the schedule view can still be opened in a new tab through its URL hash.
3. The `(shared)` exercise slot is always shown with its exercise and is not selectable.
4. English UI; course titles as TUMonline gives them.
5. Preact + Vite + TypeScript now, embedded into Astro later.

## Open points

- Whether non-lecture types should also get exercises in the schedule view: not planned (only lectures have `UE` courses in the data).
- Whether language courses should be collapsed further (they are about 90 boxes): left as one checkbox, off by default.

## Status (2026-10-18)

Implemented and tested: M0 to M6 except where noted.

- **M0 data:** `lecturer`, `course_group` tables and `course.language` added to the scraper; `export_data.py` writes `app/public/data/schedule.json` (124 courses: 26 lectures, 90 language, 4 seminars, 2 practicals, 1 research, 1 workshop; 11 exercises; 8 courses without dates) with consistency checks.
  - The course record lists only 5 lecturers (`displayMoreLectureships`); the rest is merged in from the group records.
  - Title labels strip leading/trailing module-id groups (`(IN2309, IN2126)`, `[MA5617]`).
  - One exercise ("Intensivkurs Proteomics") belongs to no lecture's module; it is exported but never shown (no lecture to hang it on).
- **M1 to M3:** Vite + Preact + TypeScript app in `app/`; week grid with lanes and horizontal scroll, popup, checkboxes, search, registration filter, type/category filter checkboxes with counts.
- **M4 to M5:** selection persists in `localStorage` and the URL hash; schedule view with Show exercises, group picking with grey-out, fixed shared slots, conflict markers, "would clash" outline, summary panel (ECTS counted once per module, pending exercise groups, conflicts, undated groups).
- **M6:** keyboard (Enter opens, Space toggles the native checkbox, Escape closes), light/dark colours via CSS variables (dark mode not visually checked), unit tests (14) and an end-to-end test (Chrome, 20 checks).

Deviations from the design above:
- `CourseBox` was folded into `WeekGrid.tsx` (one component draws all boxes).
- Checkboxes for exercise groups use the same top-right checkbox as lectures.
- Not done yet: print/screenshot-friendly schedule, ICS export, M7 (Astro embedding).

## Update: catalogs, credits and box content (2026-10-18)

Requested and implemented:

1. **ECTS on the boxes:** the second line of a box shows "time · N ECTS" (credits of the course's credit module). Exercise boxes show the group name instead; they carry no credits of their own.
2. **No type tags:** the VO/VI/UE badges are gone from the boxes and the "no dates" list. Lectures are colour coded by catalog (see 3); other course types keep their own colour (seminar pink, practical orange, research tan, workshop cyan, language yellow). The popup still names the type.
3. **Catalogs for lectures:** each module belongs to one of
   - Methoden und Forschung (minimum 33 credits),
   - Informatik, Mathematik und Statistik (15),
   - Biologie/Biochemie/Chemie (15),
   - Überfachliche Grundlagen (3 to 6; the fourth catalog of the regulation, kept as a fourth category and shown as its own row),
   with 78 credits required over all elective modules. Lecture boxes use one colour per catalog; a lecture whose module is in no catalog is grey.
4. **Credits per catalog:** a strip above the grid in the main view and a column in the schedule summary show collected / required credits per catalog and the total (x / 78), updated while selecting. The swatches double as the colour legend. Selected modules in no catalog are listed as "Not in a catalog" and do not count towards the 78.

**Source precedence (decision of 2026-10-18): the regulation PDF is the up-to-date source, so it has priority, for the catalog and for the credits alike: PDF > handbook module page > website (older 2021 rules).** Reconsider this when the handbook or the website is updated.

How the catalog and credits of a module are decided (`build_catalog.py`, `tum/catalog.py`):
- Sources: the regulation PDF (`data/fpso_modulkatalog.pdf`, 50 modules, parsed with `pdftotext`), the CIT website tables (79 modules), and the catalog path and ECTS printed on each handbook module page for SPO 20261.
- Modules missing from the PDF fall back to the handbook, then the website. CIT323007 is in neither the PDF nor the website, so its catalog ("Informatik, Mathematik und Statistik") and its 6 credits come from the handbook.
- The sources agree on the catalog for every shared module except IN5187 (handbook lists two catalogs, website says Methoden und Forschung, PDF says Überfachliche Grundlagen: the PDF is used).
- Credit differences, decided by the same rule: WZ2439 counts 6 credits (PDF; handbook and website say 5); CIT4230001 counts 6 (PDF and handbook; website says 4); IN2361 counts 6 (not in the PDF, so the handbook; website says 5).
- `data/catalog_report.md` is regenerated by `build_catalog.py` and lists every disagreement with the value used.
- A course listed in two exclusive modules counts once, with the module of highest ECTS (`credit_module`).

Limits: the Computational Neuroscience Ringvorlesung is linked to no module (the offer nodes do not list it), so it shows grey and counts nothing; credits are those of the module, regardless of how many of its courses are selected.

### Credit discrepancies are always shown (requirement, 2026-10-18)

Wherever credits appear, a disagreement between the sources (regulation PDF, handbook, website) is marked and explained, never silently resolved:
- `export_data.py` writes per module `ects_sources` (pdf / handbook / web), `ects_used_from` and `ects_conflict`, and per course `ects_conflict`; it prints the affected modules on every export (currently CIT4230001, IN2361, WZ2439).
- Source labels in the UI (decision 2026-10-18): the PDF value is shown as **"ECTS acc. to FPSO 26"**, the handbook value as **"ECTS acc. to TUM module handbook"**, the website value as "ECTS acc. to CIT website (2021 rules)"; a missing value reads "not listed".
- Boxes show a red `*` after the ECTS; hovering gives the text, e.g. "Credits differ between sources: ECTS acc. to FPSO 26: not listed; ECTS acc. to TUM module handbook: 6; ECTS acc. to CIT website (2021 rules): 5. Counted: 6 (TUM module handbook)."
- The popup shows the sources as a list in a highlighted note under the module, the counted one in bold marked "(counted)".
- The credits panel (main view and schedule summary) marks the catalog row and the total with `*` when a selected module is affected, and lists each affected module with all source values and the counted value in a highlighted footnote. In the main view a short legend line appears whenever a marked box is visible.
- Covered by unit tests (`creditNote`, `creditNotes`) and by the end-to-end test (box marker, popup note, footnote, row marker, footnote removed on deselect).

### One-off dates of lectures (decision 2026-10-18)

A lecture that has a recurring pattern (at least one slot with 2 or more occurrences) does not draw its single-occurrence slots as boxes. Example: WZ8119 Systems BioMedicine has Wednesday 10:00-12:00 (5 dates) plus a single Wednesday 2027-02-03 10:00-15:00, which looked like a second overlapping lecture; four other lectures had the same pattern (the main view went from 38 to 33 lecture boxes).
- The hidden dates are listed in the popup under "Single dates (not drawn in the week grid)"; the box tooltip mentions them.
- They also take no part in the conflict check.
- Lectures that have only single dates keep their boxes, and the rule applies to lectures only, not to seminars, practicals or exercises.
- Implemented in `app/src/lib/slots.ts` (`gridSlots`, `oneOffSlots`), covered by unit tests and an end-to-end check.

## Update: source links and contact box (2026-10-18)

Footer (`app/src/components/Footer.tsx`) and header, content in `app/src/config.ts`:
- **Sources** links (moved to the top right of the header, see the next section) to to the TUM module handbook (`https://campus.tum.de/tumonline/WBMODHB.wbShow?pOrgNr=1`), the FPSO Bioinformatics M.Sc. of 23.07.2026 (PDF on tum.de) and the Modulkatalog on the CIT website. These are the three credit/catalog sources named in the credit labels ("ECTS acc. to FPSO 26", "... TUM module handbook", "... CIT website").
- **Contact box** (bottom left): heading, name, email (as `mailto:`) and a free note. **To be filled in by the owner in `app/src/config.ts`, object `CONTACT`** (`name`, `email`, `note`); empty fields are not shown, and while all are empty the box says details are missing. Rebuild with `npm run build`.
- Not covered by unit or e2e tests yet.

## Update: look and header (2026-10-18)

- **Sources** now sit top right in the header (`nav.sources`, fed by `SOURCES` in `app/src/config.ts`); the footer keeps only the contact box.
- **Title:** "Stundenplan creator M.Sc. Bioinformatik acc. to FPSO 26" (page heading and `<title>`); term and data date follow as a muted subtitle.
- **Background black:** `--bg: #000000`, panels `#12151a`. The dark palette is now the only theme (the `prefers-color-scheme` switch is removed), so the earlier "light/dark" item in M6 no longer applies.
- **Font +2 px:** every pixel font size in `style.css` raised by 2 (base 14 -> 16 px, box titles 12.5 -> 14.5 px). Grid sizes (px per minute) unchanged, so short boxes clamp their title lines. Not checked visually on small screens.
- Unit tests (23) and e2e pass.

## Note: automatic data updates (2026-10-20, decision: not implemented)

Only meaningful once the page is hosted (GitHub Pages or merged into the real Astro site), so nothing is built now. Locally, rerun `scrape.py`, `build_catalog.py`, `export_data.py` and `npm run build` by hand.

This is the M7 work. Plan for later:
- A GitHub Actions workflow with `on: schedule` (e.g. daily) and `workflow_dispatch`: install poppler-utils (for `pdftotext`), run the three scripts, `npm run build`, deploy to Pages. Pages serves static files only, so a rebuild is the only way to refresh the data; the browser never calls TUMonline.
- The `generated` date in `schedule.json` is already shown in the header, so visitors see how old the data is.
- Keep the last good build: if the scrape or the export checks fail, the workflow fails and the previous site stays online.
- Risks: the undocumented REST API may change or throttle GitHub runner IPs; `raw/` cache and `data/fpso_modulkatalog.pdf` must be committed or restored from the Actions cache; the FPSO PDF link has a date in its name and must be updated by hand when a new regulation version appears.

## Note: cleanup check (2026-10-20)

The web app reads only `app/public/data/schedule.json`; it uses neither `raw/` nor `query.py`. For hosting only `app/dist/` is needed. Details of the check of `raw/pos` and `query.py`: see `plan_data_scraper.md`, "Cleanup check". Plan files were renamed (`plan.md` -> `plan_data_scraper.md`, `plan_schedule.md` -> `plan_web_app.md`).
