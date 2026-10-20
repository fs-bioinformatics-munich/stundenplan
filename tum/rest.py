import json
import re

from .http import BASE, fetch

REST = BASE + "/ee/rest/slc.tm.cp/student"
UI = BASE + "/ee/ui/ca2/app/desktop/#/slc.tm.cp/student/courses"
TOP = 20


def _search(filter_term, term_id, kind, key, refresh):
    found, skip = [], 0
    while True:
        flt = f"courseNormKey-eq=LVEAB;filterTerm-like={filter_term};orgId-eq=1;termId-eq={term_id}"
        url = f"{REST}/courses?$filter={flt}&$orderBy=title=ascnf&$skip={skip}&$top={TOP}"
        data = json.loads(fetch(url, kind, f"{key}_{skip}", json=True, refresh=refresh))
        batch = _collect(data)
        found += batch
        if len(batch) < TOP:
            return found
        skip += TOP


def curriculum_courses(curriculum_id, term_id, refresh=False):
    """All courses of a term attached to a curriculum version (filter curriculumVersionId)."""
    found, skip = [], 0
    while True:
        flt = f"courseNormKey-eq=LVEAB;orgId-eq=1;termId-eq={term_id};curriculumVersionId-eq={curriculum_id}"
        url = f"{REST}/courses?$filter={flt}&$orderBy=title=ascnf&$skip={skip}&$top=50"
        data = json.loads(fetch(url, "curriculum", f"{curriculum_id}_{term_id}_{skip}", json=True, refresh=refresh))
        batch = _collect(data)
        found += batch
        if len(batch) < 50:
            return found
        skip += 50


ID_RE = re.compile(r"[A-Z]{2,}[A-Z0-9]*\d{3,}[A-Za-z0-9]*")
PREFIX_RE = re.compile(r"^(exercises? for|exercise|übungen? zu|übung|zentralübung zu|tutorial for|tutorial)\s*[-:]?\s+", re.I)
SUFFIX_RE = re.compile(r"\s*\((lecture|exercise|seminar|vo und ue|vorlesung|übung)\)\s*$", re.I)


def id_tokens(title):
    groups = re.findall(r"[(\[]([^)\]]*)[)\]]", title)
    return {t.upper() for g in groups for t in re.split(r"[,;/\s]+", g) if t}


def base_title(title):
    t = re.sub(r"\s*[(\[][^)\]]*[)\]]\s*", " ", SUFFIX_RE.sub("", title)).strip()
    t = PREFIX_RE.sub("", t)
    return re.sub(r"[^\w]+", " ", t.lower()).strip()


def match_course(c, module_id, module_name):
    """Return 'id' | 'name' | None for how a course belongs to a module."""
    want = {module_id.replace(" ", "").upper(), module_id.split()[0].upper()}
    num = c["number"].lstrip("0").replace(" ", "").upper()
    if any(num.endswith(w) for w in want) or want & id_tokens(c["title"]):
        return "id"
    ids_in_title = {t for t in id_tokens(c["title"]) if ID_RE.fullmatch(t)}
    if ids_in_title:          # title names other modules: never match by name
        return None
    if base_title(c["title"]) == base_title(module_name):
        return "name"
    return None


def search_candidates(module_id, module_name, term_id, refresh=False):
    """Courses found by module id and by module name (substring search; matching done by match_course)."""
    by_id = _search(module_id, term_id, "search", f"{module_id}_{term_id}", refresh)
    clean = re.sub(r"\s*\(.*?\)", "", module_name).strip()
    by_name = _search(clean, term_id, "xname", f"{module_id}_{clean}", refresh) if clean else []
    return {c["course_id"]: c for c in by_id + by_name}.values()


def _collect(node):
    out = []
    if isinstance(node, dict):
        if "courseTitle" in node and "courseNumber" in node and "id" in node:
            out.append({
                "course_id": node["id"],
                "number": node["courseNumber"]["courseNumber"],
                "title": node["courseTitle"]["value"],
            })
        else:
            for v in node.values():
                out += _collect(v)
    elif isinstance(node, list):
        for v in node:
            out += _collect(v)
    return out


def course_detail(course_id, refresh=False):
    d = json.loads(fetch(f"{REST}/courses/{course_id}?$ctx=lang=en", "course", str(course_id), json=True, refresh=refresh))
    c = d["resource"][0]["content"]["cpCourseDetailDto"]["cpCourseDto"]
    return {
        "type": c["courseTypeDto"]["courseTypeShortName"]["value"],
        "title": c["courseTitle"]["value"],
        "semester": c["semesterDto"]["key"],
        # registrationAvailable only says a procedure exists; the state is registrationInfoStatus
        # (RUNNING = open, NONE = expired/not started, INFO = no procedure)
        "reg_open": int(c.get("registrationInfoStatus") == "RUNNING"),
        "reg_status": c.get("registrationInfoStatus"),
        "reg_info": (c.get("registrationInfo") or {}).get("value"),
        "language": ", ".join(_language_names(c)),
        "course_url": f"{UI}/{course_id}",
        "registration_url": f"{UI}/{course_id}/registrationProcedures" if c.get("registrationAvailable") else None,
    }


def _language_names(c):
    names = []
    for l in c.get("courseLanguageDtos", []):
        n = l["languageDto"]["name"]
        en = [t.get("value") for t in n.get("translations", {}).get("translation", []) if t.get("lang") == "en"]
        names.append((en[0] if en and en[0] else n["value"]))
    return names


ROLES = {"Leiter*in": "Head", "Vortragende*r": "Lecturer"}


def course_lecturers(course_id, refresh=False):
    """Lecturers of a course. The course record lists only the first 5 (displayMoreLectureships),
    so the group records are merged in. Head ("Leiter*in") only appears on the course record."""
    d = json.loads(fetch(f"{REST}/courses/{course_id}?$ctx=lang=en", "course", str(course_id), json=True, refresh=refresh))
    c = d["resource"][0]["content"]["cpCourseDetailDto"]["cpCourseDto"]
    people = {}
    groups, _ = _groups(course_id, refresh)
    entries = [(l, "course") for l in c.get("lectureships", [])] + \
              [(l, "group") for g in groups for l in g.get("lectureshipDtos", [])]
    for l, source in entries:
        i = l["identityLibDto"]
        role = ROLES.get(l["teachingFunction"]["name"], l["teachingFunction"]["name"])
        p = people.setdefault(i["personId"], {"name": f'{i["firstName"]} {i["lastName"]}'.strip(), "role": role})
        if role == "Head":
            p["role"] = "Head"
    return [{"person_id": k, **v} for k, v in sorted(people.items(), key=lambda kv: (kv[1]["role"] != "Head", kv[1]["name"]))]


def _groups(course_id, refresh):
    """All groups of a course. firstGroups returns only the first 5; the rest sit in remainingGroups."""
    first = json.loads(fetch(f"{REST}/courseGroups/firstGroups/{course_id}?$ctx=lang=en", "groups", str(course_id), json=True, refresh=refresh))
    groups = list(first.get("courseGroupDtos", []))
    if first.get("totalCount", len(groups)) > len(groups):
        rest = json.loads(fetch(f"{REST}/courseGroups/remainingGroups/{course_id}?$ctx=lang=en", "groups_rest", str(course_id), json=True, refresh=refresh))
        groups += rest.get("courseGroupDtos", [])
    return groups, first.get("totalCount", len(groups))


def course_group_names(course_id, refresh=False):
    """Names of all groups, including groups without dates."""
    return [g["name"] for g in _groups(course_id, refresh)[0]]


def course_slots(course_id, refresh=False):
    """One slot per (group, weekday, start, end, room), with date range and number of dates.

    Built from the individual appointments (series-less dates exist, e.g. shared lectures of
    exercise groups). An appointment listed under several groups is reported once as '(shared)'.
    """
    groups, total = _groups(course_id, refresh)
    if total != len(groups):
        raise ValueError(f"expected {total} groups, got {len(groups)}")
    appts, owners = {}, {}
    for g in groups:
        for a in g.get("appointmentDtos", []):
            appts[a["id"]] = a
            owners.setdefault(a["id"], []).append(g["name"])
    agg = {}
    for aid, a in appts.items():
        if a.get("appointmentStatusType") != "CONFIRMED":
            continue
        grp = owners[aid][0] if len(owners[aid]) == 1 else "(shared)"
        t0, t1 = a["timestampFrom"]["value"], a["timestampTo"]["value"]
        key = (grp, a["weekday"]["langDataType"]["value"], t0[11:16], t1[11:16], a.get("resourceName"))
        e = agg.setdefault(key, {"first": t0[:10], "last": t0[:10], "n": 0})
        e["first"], e["last"], e["n"] = min(e["first"], t0[:10]), max(e["last"], t0[:10]), e["n"] + 1
    return [{"group_name": k[0], "weekday": k[1], "start_time": k[2], "end_time": k[3], "room": k[4],
             "first_date": v["first"], "last_date": v["last"], "n_dates": v["n"]}
            for k, v in sorted(agg.items())]
