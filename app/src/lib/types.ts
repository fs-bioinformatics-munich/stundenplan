export interface Slot {
  day: number; // 1 = Monday
  start: string; // HH:MM
  end: string;
  room: string | null;
  first: string;
  last: string;
  n: number;
}

export interface Lecturer { name: string; role: string }

export interface Registration {
  open: boolean;
  status: string | null;
  info: string | null;
  url: string | null;
}

export type CatalogKey = 'methods' | 'cs' | 'bio' | 'interdisc';

export type Category = 'lecture' | 'seminar' | 'practical' | 'research' | 'workshop' | 'language';

export interface Course {
  id: number;
  type: string;
  category: Category;
  title: string;
  label: string;
  modules: string[];
  credit_module: string | null; // the module whose credits this course counts for
  ects: number | null;
  ects_conflict: boolean;
  catalog: CatalogKey | null;
  language: string | null;
  lecturers: Lecturer[];
  registration: Registration;
  course_url: string;
  slots: Slot[];
}

export interface ExerciseGroup { name: string; slots: Slot[] }

export interface Exercise extends Omit<Course, 'slots' | 'category'> {
  lecture_ids: number[];
  fixed_slots: Slot[];
  groups: ExerciseGroup[];
}

export interface ModuleInfo {
  name: string;
  ects: number | null;
  url: string;
  turnus: string | null;
  catalog: CatalogKey | null;
  catalog_sources: { pdf: CatalogKey | null; handbook: CatalogKey[]; web: CatalogKey | null };
  catalog_from: 'pdf' | 'handbook' | 'web' | null;
  ects_sources: { pdf: number | null; handbook: number | null; web: number | null };
  ects_used_from: 'pdf' | 'handbook' | 'web' | null;
  ects_conflict: boolean; // the sources disagree on the credits: must be shown wherever credits are
}

/** A module of the CIT Modulkatalog that only has a module description PDF; selectable although it has no timetable. */
export interface CitModule {
  id: string;
  name: string;
  catalog: CatalogKey | null;
  credits: number; // the credits that count
  credits_used_from: 'pdf' | 'handbook' | 'web' | 'module_pdf' | 'manual' | null;
  credits_sources: { pdf: number | null; handbook: number | null; web: number | null; module_pdf: number | null };
  credits_conflict: boolean;
  title: string | null;
  type: string | null;
  teaching_form: string | null;
  language: string | null;
  level: string | null;
  turnus: string | null;
  lecturers: string[];
  responsible: string | null;
  workload: { presence: number | null; self: number | null; total: number | null };
  pdf_url: string;
  manual_fields: string[]; // fields corrected by hand in data/cit_modules_manual.json
}

export interface CatalogInfo { label: string; min: number; max?: number }

export interface ScheduleData {
  term: string;
  generated: string;
  catalogs: Record<CatalogKey, CatalogInfo>;
  total_min: number;
  modules: Record<string, ModuleInfo>;
  courses: Course[];
  exercises: Exercise[];
  cit_modules: CitModule[];
  no_dates: number[];
}
