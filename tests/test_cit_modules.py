import unittest
from pathlib import Path

from tum import cit_modules

FIX = Path(__file__).parent / "fixtures"

# module numbers of the 22 PDF links in the FPSO 2026 section of the Modulkatalog page (read off the page by hand)
PDF_IDS = {
    "IN5022", "IN5020", "IN5021", "IN5019", "IN5088", "IN5073", "IN5116", "IN5096",   # Methoden und Forschung
    "IN5089", "IN5159", "IN5042", "IN5043", "IN5176", "IN5085",                       # Informatik, Mathematik und Statistik
    "IN5036", "IN5035", "IN5062", "IN5064", "IN5065", "IN5066", "IN5037",             # Biologie/Biochemie/Chemie
    "CIT802000",                                                                       # Ueberfachliche Grundlagen
}


class FindPdfModules(unittest.TestCase):
    def setUp(self):
        html = (FIX / "modulkatalog_tables.html").read_text(encoding="utf-8")
        self.found = {m["module_id"]: m for m in cit_modules.find_pdf_modules(html)}

    def test_finds_exactly_the_modules_that_link_to_a_pdf(self):
        self.assertEqual(set(self.found), PDF_IDS)

    def test_relative_links_become_absolute(self):
        self.assertEqual(
            self.found["IN5088"]["pdf_url"],
            "https://www.cit.tum.de/fileadmin/w00byx/cit/Studium/Studiengaenge/Bachelor_Bioinformatik/LMU_Module/IN5088_CompMethEvolBiol.pdf",
        )

    def test_catalog_comes_from_the_table(self):
        self.assertEqual(self.found["IN5022"]["catalog"], "methods")
        self.assertEqual(self.found["IN5042"]["catalog"], "cs")
        self.assertEqual(self.found["IN5036"]["catalog"], "bio")
        self.assertEqual(self.found["CIT802000"]["catalog"], "interdisc")

    def test_name_and_table_credits(self):
        m = self.found["CIT802000"]
        self.assertEqual(m["name"], "Wissenschaftliches Schreiben für Bioinformatik")
        self.assertEqual(m["catalog_credits"], 3)
        self.assertEqual(self.found["IN5022"]["catalog_credits"], 9)


def fields(module_id):
    return cit_modules.parse_module_pdf((FIX / f"{module_id}.txt").read_text(encoding="utf-8"))["fields"]


class ParseKeyValues(unittest.TestCase):
    def test_simple_rows(self):
        f = fields("CIT802000")
        self.assertEqual(f["Typ"], "Seminar")
        self.assertEqual(f["Credits"], "3")
        self.assertEqual(f["Lehrform/SWS"], "2S")
        self.assertEqual(f["Modulverantwortlicher"], "Prof. Dr. Caroline Friedel")

    def test_wrapped_values_are_joined(self):
        f = fields("CIT802000")
        self.assertEqual(f["Sprache"], "Deutsch oder Englisch (wird zum Beginn der Veranstaltung bekannt gegeben)")
        self.assertEqual(f["Turnus"], "Jährlich (Wintersemester; bei Bedarf zusätzlich oder alternativ auch im Sommersemester)")

    def test_keys_spread_over_two_lines_are_joined(self):
        f = fields("CIT802000")
        self.assertTrue(f["Angestrebte Lernergebnisse"].startswith("Nach erfolgreichem Abschluss des Moduls"))
        self.assertTrue(f["Intended Learning Outcomes"].startswith("Upon successful completion of the module"))

    def test_other_modules(self):
        self.assertEqual(fields("IN5022")["Turnus"], "unregelmäßig")
        self.assertEqual(fields("IN5022")["Title"], "Algorithms on Sequences")
        self.assertEqual(fields("IN5022")["Lehrform/SWS"], "4V + 2Ü")
        self.assertEqual(fields("IN5176")["Credits"], "6 ECTS")
        self.assertEqual(fields("IN5176")["Turnus"], "Wintersemester")

    def test_value_column_may_move_between_pages(self):
        # page 2 of CIT802000 starts the value column further left than page 1
        self.assertTrue(fields("CIT802000")["Inhalt"].startswith("Dieses Seminar vermittelt zentrale Kompetenzen"))


def parsed(module_id):
    return cit_modules.parse_module_pdf((FIX / f"{module_id}.txt").read_text(encoding="utf-8"))


class NormalizedFields(unittest.TestCase):
    def test_seminar(self):
        m = parsed("CIT802000")
        self.assertEqual(m["title"], "Wissenschaftliches Schreiben für Bioinformatik")
        self.assertEqual(m["type"], "Seminar")
        self.assertEqual(m["credits"], 3)
        self.assertEqual(m["teaching_form"], "2S")
        self.assertEqual(m["level"], "Master")
        self.assertEqual(m["workload"], {"presence": 30, "self": 60, "total": 90})
        self.assertEqual(m["lecturers"], ["Prof. Dr. Caroline Friedel"])
        self.assertEqual(m["responsible"], "Prof. Dr. Caroline Friedel")

    def test_title_falls_back_to_the_english_one(self):
        self.assertEqual(parsed("IN5022")["title"], "Algorithms on Sequences")

    def test_credits_with_unit_and_other_workload(self):
        m = parsed("IN5176")
        self.assertEqual(m["credits"], 6)
        self.assertEqual(m["language"], "Englisch")
        self.assertEqual(m["turnus"], "Wintersemester")
        self.assertEqual(m["workload"], {"presence": 75, "self": 105, "total": 180})
        self.assertEqual(parsed("IN5022")["workload"], {"presence": 90, "self": 180, "total": 270})


SCRAPED = {
    "IN5022": {"name": "Algorithmen auf Sequenzen", "catalog": "methods", "credits": 9, "turnus": "unregelmäßig", "lecturers": ["Prof. Dr. Volker Heun"]},
    "IN5176": {"name": "Deep Learning and Artificial Intelligence", "catalog": "cs", "credits": 6, "turnus": None, "lecturers": []},
}


class MergeManual(unittest.TestCase):
    def test_manual_values_win_and_are_marked(self):
        merged = cit_modules.merge_manual(SCRAPED, {"IN5022": {"turnus": "Wintersemester", "credits": 8}})
        self.assertEqual(merged["IN5022"]["turnus"], "Wintersemester")
        self.assertEqual(merged["IN5022"]["credits"], 8)
        self.assertEqual(merged["IN5022"]["manual_fields"], ["credits", "turnus"])
        self.assertEqual(merged["IN5022"]["name"], "Algorithmen auf Sequenzen")

    def test_modules_without_corrections_stay_as_scraped(self):
        merged = cit_modules.merge_manual(SCRAPED, {"IN5022": {"credits": 8}})
        self.assertEqual(merged["IN5176"], {**SCRAPED["IN5176"], "manual_fields": []})

    def test_manual_null_clears_a_scraped_value(self):
        self.assertIsNone(cit_modules.merge_manual(SCRAPED, {"IN5022": {"turnus": None}})["IN5022"]["turnus"])

    def test_inputs_are_not_modified(self):
        manual = {"IN5022": {"credits": 8}}
        cit_modules.merge_manual(SCRAPED, manual)
        self.assertEqual(SCRAPED["IN5022"]["credits"], 9)
        self.assertEqual(manual, {"IN5022": {"credits": 8}})

    def test_a_correction_for_an_unknown_module_is_an_error(self):
        with self.assertRaisesRegex(ValueError, "IN9999"):
            cit_modules.merge_manual(SCRAPED, {"IN9999": {"credits": 3}})


class LayoutVariants(unittest.TestCase):
    def test_keys_indented_by_one_space_and_hours_written_as_h(self):
        # IN5089: a title line at column 0 above keys that start in column 1; "Lehrform / SWS" with spaces; "60 h"
        m = parsed("IN5089")
        self.assertEqual(m["credits"], 6)
        self.assertEqual(m["type"], "Lecture with exercise")
        self.assertEqual(m["teaching_form"], "3V + 1Ü")
        self.assertEqual(m["workload"], {"presence": 60, "self": 120, "total": 180})
        self.assertEqual(m["turnus"], "Sommersemester")

    def test_long_key_followed_by_one_space_only(self):
        # IN5116: "Modulverantwortlicher Prof. Dr. Ralf Zimmer" has no two-space gap
        m = parsed("IN5116")
        self.assertEqual(m["turnus"], "Unregelmäßig")
        self.assertEqual(m["responsible"], "Prof. Dr. Ralf Zimmer")

    def test_key_without_value_and_two_line_keys_without_value_on_the_second_line(self):
        # IN5064: "Modulverantwortlicher" stays empty; "Lehr- und" / "Lernmethode" and "Teaching and Learning" / "Methods"
        m = parsed("IN5064")
        self.assertEqual(m["turnus"], "WS, jährlich")
        self.assertEqual(m["responsible"], "")
        self.assertEqual(m["lecturers"], ["Prof. Beckmann"])
        self.assertEqual(m["fields"]["Lehr- und Lernmethode"], "Vorlesung")
        self.assertEqual(m["fields"]["Teaching and Learning Methods"], "lecture")
        self.assertNotIn("Methods", m["fields"])

    def test_wrapped_key_followed_by_one_space_only(self):
        # IN5073: "Teaching and Learning computer lab course, ..." / "Methods colloquium, report"
        f = parsed("IN5073")["fields"]
        self.assertTrue(f["Teaching and Learning Methods"].startswith("computer lab course, project, presentation, colloquium, report"))
        self.assertNotIn("Methods", f)

    def test_turnus_may_be_called_haeufigkeit(self):
        self.assertEqual(parsed("IN5021")["turnus"], "Sommersemester")


def merged_module(**kw):
    base = {"name": "Algorithmen auf Sequenzen", "catalog": "methods", "catalog_credits": 9, "credits": 9, "pdf_url": "https://x/IN5022.pdf",
            "pdf_file": "data/cit_modules/IN5022.pdf", "lecturers": [], "manual_fields": []}
    return {**base, **kw}


def spo_module(fpso, handbook, web, catalog="methods", ects=None, used="pdf"):
    return {"name": "m", "catalog": catalog, "ects": ects if ects is not None else fpso,
            "ects_sources": {"pdf": fpso, "handbook": handbook, "web": web}, "ects_used_from": used}


class ExportRecords(unittest.TestCase):
    def export(self, merged, modules):
        return {r["id"]: r for r in cit_modules.export_records({"IN5022": merged}, modules)}["IN5022"]

    def test_module_of_the_spo_counts_the_resolved_credits_and_catalog(self):
        r = self.export(merged_module(), {"IN5022": spo_module(9, 9, 9, catalog="cs")})
        self.assertEqual((r["credits"], r["credits_used_from"], r["credits_conflict"], r["catalog"]), (9, "pdf", False, "cs"))
        self.assertEqual(r["credits_sources"], {"pdf": 9, "handbook": 9, "web": 9, "module_pdf": 9})

    def test_module_description_that_disagrees_is_flagged(self):
        r = self.export(merged_module(credits=8), {"IN5022": spo_module(9, 9, 9)})
        self.assertEqual((r["credits"], r["credits_conflict"], r["credits_sources"]["module_pdf"]), (9, True, 8))

    def test_module_outside_the_spo_uses_the_website_table(self):
        r = self.export(merged_module(credits=3, catalog_credits=3, catalog="interdisc"), {})
        self.assertEqual((r["credits"], r["credits_used_from"], r["credits_conflict"], r["catalog"]), (3, "web", False, "interdisc"))
        self.assertEqual(r["credits_sources"], {"pdf": None, "handbook": None, "web": 3, "module_pdf": 3})

    def test_manual_credits_are_counted_and_still_flagged_when_they_differ(self):
        r = self.export(merged_module(credits=4, manual_fields=["credits"]), {})
        self.assertEqual((r["credits"], r["credits_used_from"], r["credits_conflict"]), (4, "manual", True))

    def test_missing_credits_everywhere_are_an_error(self):
        with self.assertRaisesRegex(ValueError, "IN5022"):
            self.export(merged_module(credits=None, catalog_credits=None), {})


if __name__ == "__main__":
    unittest.main()
