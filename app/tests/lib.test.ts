import { describe, expect, it } from 'vitest';
import { assignLanes, maxLanesPerDay } from '../src/lib/layout';
import { toggleCitModule, clashesWith, committedBlocks, conflictKeys, creditsByCatalog, emptyState, groupState, pickGroup, toggleCourse, lecturesWithoutPick, ectsSum } from '../src/lib/selection';
import { catalogConflict, catalogLines, citCreditNote, creditNote, creditNotes } from '../src/lib/credits';
import { gridSlots, oneOffSlots } from '../src/lib/slots';
import { decodeHash, encodeHash } from '../src/lib/store';
import type { CitModule, ScheduleData } from '../src/lib/types';

const b = (key: string, day: number, start: number, end: number) => ({ key, day, start, end });

describe('assignLanes', () => {
  it('puts a lone box in lane 0 of 1', () => {
    expect(assignLanes([b('a', 1, 600, 720)]).get('a')).toEqual({ lane: 0, lanes: 1 });
  });
  it('does not overlap touching boxes', () => {
    const p = assignLanes([b('a', 1, 600, 720), b('b', 1, 720, 840)]);
    expect(p.get('a')).toEqual({ lane: 0, lanes: 1 });
    expect(p.get('b')).toEqual({ lane: 0, lanes: 1 });
  });
  it('places identical times side by side', () => {
    const p = assignLanes([b('a', 2, 600, 720), b('b', 2, 600, 720), b('c', 2, 600, 720)]);
    expect([...p.values()].map((x) => x.lanes)).toEqual([3, 3, 3]);
    expect(new Set([...p.values()].map((x) => x.lane)).size).toBe(3);
  });
  it('handles chained overlaps in one cluster and reuses a free lane', () => {
    // a 600-700, b 650-800, c 700-760 (c reuses a's lane), d 900-960 separate cluster
    const p = assignLanes([b('a', 1, 600, 700), b('b', 1, 650, 800), b('c', 1, 700, 760), b('d', 1, 900, 960)]);
    expect(p.get('a')).toEqual({ lane: 0, lanes: 2 });
    expect(p.get('b')).toEqual({ lane: 1, lanes: 2 });
    expect(p.get('c')).toEqual({ lane: 0, lanes: 2 });
    expect(p.get('d')).toEqual({ lane: 0, lanes: 1 });
  });
  it('keeps days independent and reports max lanes per day', () => {
    const boxes = [b('a', 1, 600, 700), b('b', 1, 600, 700), b('c', 2, 600, 700)];
    const p = assignLanes(boxes);
    expect(maxLanesPerDay(boxes, p).get(1)).toBe(2);
    expect(maxLanesPerDay(boxes, p).get(2)).toBe(1);
  });
  it('needs five lanes for five simultaneous boxes', () => {
    const boxes = [1, 2, 3, 4, 5].map((i) => b(`k${i}`, 3, 480, 600));
    const p = assignLanes(boxes);
    expect(maxLanesPerDay(boxes, p).get(3)).toBe(5);
  });
});

const slot = (day: number, start: string, end: string) => ({ day, start, end, room: null, first: '2026-10-12', last: '2027-02-01', n: 15 });
const reg = { open: true, status: 'RUNNING', info: null, url: null };
const common = { type: 'VO', title: 't', language: null, lecturers: [], registration: reg, course_url: '', modules: ['M1'], credit_module: 'M1', ects: 6, ects_conflict: false, catalog: 'cs' as const };

const mod = { url: '', turnus: null, catalog_sources: { pdf: null, handbook: [], web: null }, catalog_from: null, ects_sources: { pdf: null, handbook: null, web: null }, ects_used_from: 'handbook' as const, ects_conflict: false };

const cit = (id: string, over: Partial<CitModule> = {}): CitModule => ({
  id, name: `cit ${id}`, catalog: 'methods', credits: 9, credits_used_from: 'pdf', credits_conflict: false,
  credits_sources: { pdf: 9, handbook: null, web: 9, module_pdf: 9 }, title: null, type: null, teaching_form: null, language: null,
  level: null, turnus: null, lecturers: [], responsible: null, workload: { presence: null, self: null, total: null },
  pdf_url: '', manual_fields: [], ...over,
});

const data: ScheduleData = {
  term: 'T', generated: '', no_dates: [], total_min: 78,
  cit_modules: [
    cit('C1'), cit('C2', { catalog: 'interdisc', credits: 3, credits_sources: { pdf: null, handbook: null, web: 3, module_pdf: 3 }, credits_used_from: 'web' }),
    cit('M1', { catalog: 'cs', credits: 6, credits_sources: { pdf: 6, handbook: null, web: 6, module_pdf: 6 } }),
    cit('C4', { catalog: 'bio', credits: 6, credits_used_from: 'web', credits_conflict: true, credits_sources: { pdf: null, handbook: null, web: 6, module_pdf: 5 } }),
    cit('C5', { catalog: null, credits: 4 }),
  ],
  catalogs: {
    methods: { label: 'Methoden', min: 33 }, cs: { label: 'Informatik', min: 15 },
    bio: { label: 'Bio', min: 15 }, interdisc: { label: 'Überfachlich', min: 3, max: 6 },
  },
  modules: {
    M1: { ...mod, name: 'm', ects: 6, catalog: 'cs' },
    M2: { ...mod, name: 'm2', ects: 5, catalog: 'bio', ects_sources: { pdf: 5, handbook: 6, web: null }, ects_used_from: 'pdf', ects_conflict: true },
    M3: { ...mod, name: 'm3', ects: 3, catalog: null },
  },
  courses: [
    { ...common, id: 1, category: 'lecture', label: 'L1', slots: [slot(1, '10:00', '12:00')] },
    { ...common, id: 2, category: 'lecture', label: 'L2', modules: ['M2'], credit_module: 'M2', ects: 5, ects_conflict: true, catalog: 'bio', slots: [slot(1, '11:00', '13:00')] },
    { ...common, id: 3, category: 'seminar', label: 'S3', modules: ['M1'], slots: [slot(4, '10:00', '12:00')] },
    { ...common, id: 4, category: 'lecture', label: 'L4', modules: ['M3'], credit_module: 'M3', ects: 3, catalog: null, slots: [] },
    { ...common, id: 5, category: 'lecture', label: 'L5', modules: [], credit_module: null, ects: null, catalog: null, slots: [] },
  ],
  exercises: [{
    ...common, type: 'UE', id: 10, label: 'E1', lecture_ids: [1], ects: null, ects_conflict: false, catalog: null,
    fixed_slots: [slot(3, '14:00', '16:00')],
    groups: [{ name: 'G1', slots: [slot(1, '12:00', '14:00')] }, { name: 'G2', slots: [slot(1, '16:00', '18:00')] }, { name: 'G3', slots: [] }],
  }],
};

describe('selection', () => {
  it('toggles courses', () => {
    let s = toggleCourse(emptyState(), 1);
    expect(s.selected).toEqual([1]);
    s = toggleCourse(s, 1);
    expect(s.selected).toEqual([]);
  });
  it('greys out sibling groups after a pick and releases on second click', () => {
    let s = pickGroup(emptyState(), 10, 'G1');
    expect(groupState(s, 10, 'G1')).toBe('chosen');
    expect(groupState(s, 10, 'G2')).toBe('disabled');
    expect(groupState(s, 10, 'G3')).toBe('disabled');
    s = pickGroup(s, 10, 'G1');
    expect(groupState(s, 10, 'G2')).toBe('free');
  });
  it('picks of one exercise do not affect another exercise', () => {
    const s = pickGroup(emptyState(), 10, 'G1');
    expect(groupState(s, 11, 'G1')).toBe('free');
  });
  it('detects conflicts between selected lectures only', () => {
    const one = { selected: [1], picks: {}, modules: [] };
    expect(conflictKeys(committedBlocks(data, one)).size).toBe(0);
    const both = { selected: [1, 2], picks: {}, modules: [] };
    expect(conflictKeys(committedBlocks(data, both)).size).toBe(2);
  });
  it('includes the fixed slot and the chosen group, and flags clashes of free groups', () => {
    const s = { selected: [1], picks: { 10: 'G1' }, modules: [] };
    const keys = committedBlocks(data, s).map((x) => x.key);
    expect(keys).toEqual(['c1:0', 'f10:0', 'g10:G1:0']);
    expect(clashesWith(committedBlocks(data, { selected: [1], picks: {}, modules: [] }), slot(1, '11:00', '12:30'))).toBe(true);
    expect(clashesWith(committedBlocks(data, { selected: [1], picks: {}, modules: [] }), slot(1, '12:00', '14:00'))).toBe(false);
  });
  it('lists exercises without a pick and counts ECTS per module once', () => {
    expect(lecturesWithoutPick(data, { selected: [1], picks: {}, modules: [] }).map((e) => e.id)).toEqual([10]);
    expect(lecturesWithoutPick(data, { selected: [1], picks: { 10: 'G2' }, modules: [] })).toEqual([]);
    expect(ectsSum(data, { selected: [1, 2], picks: {}, modules: [] })).toBe(11);
  });
  it('sums credits per catalog, counting each module once', () => {
    expect(creditsByCatalog(data, emptyState())).toEqual({ methods: 0, cs: 0, bio: 0, interdisc: 0, other: 0, total: 0 });
    // L1 and the seminar S3 belong to the same module M1 (6 ECTS): counted once
    expect(creditsByCatalog(data, { selected: [1, 3], picks: {}, modules: [] })).toEqual({ methods: 0, cs: 6, bio: 0, interdisc: 0, other: 0, total: 6 });
    expect(creditsByCatalog(data, { selected: [1, 2], picks: {}, modules: [] })).toMatchObject({ cs: 6, bio: 5, total: 11 });
  });
  it('puts modules without catalog into "other" and keeps them out of the total', () => {
    const c = creditsByCatalog(data, { selected: [1, 4, 5], picks: {}, modules: [] });
    expect(c).toMatchObject({ cs: 6, other: 3, total: 6 });
  });
});

describe('CIT modules without a TUMonline course', () => {
  const pick = (...ids: string[]) => ids.reduce((st, id) => toggleCitModule(st, id), emptyState());
  it('toggles a module on and off', () => {
    expect(pick('C1').modules).toEqual(['C1']);
    expect(toggleCitModule(pick('C1'), 'C1').modules).toEqual([]);
  });
  it('counts its credits in its catalog, like a course', () => {
    expect(creditsByCatalog(data, pick('C1', 'C2'))).toMatchObject({ methods: 9, interdisc: 3, total: 12 });
  });
  it('counts a module in no catalog as "other"', () => {
    expect(creditsByCatalog(data, pick('C5'))).toMatchObject({ other: 4, total: 0 });
  });
  it('counts a module once when a selected course already carries its credits', () => {
    const both = { ...pick('M1'), selected: [1] };   // course 1 belongs to module M1 (6 credits, cs)
    expect(creditsByCatalog(data, both)).toMatchObject({ cs: 6, total: 6 });
  });
  it('adds up with courses of other modules', () => {
    expect(creditsByCatalog(data, { ...pick('C1'), selected: [1] })).toMatchObject({ methods: 9, cs: 6, total: 15 });
  });
  it('explains a credit discrepancy of a selected module, only when selected', () => {
    expect(creditNotes(data, pick('C1'))).toEqual([]);
    const n = creditNotes(data, pick('C4'));
    expect(n.map((x) => [x.module, x.catalog])).toEqual([['C4', 'bio']]);
    expect(n[0].text).toContain('ECTS acc. to CIT module description (PDF): 5');
    expect(n[0].text).toContain('Counted: 6 (CIT website)');
  });
  it('describes every source in the note', () => {
    expect(citCreditNote(data.cit_modules[3])).toContain('ECTS acc. to FPSO 26: not listed');
  });
});

describe('credit discrepancies', () => {
  it('describes every source and the value used', () => {
    const text = creditNote(data.modules.M2);
    expect(text).toContain('ECTS acc. to FPSO 26: 5');
    expect(text).toContain('ECTS acc. to TUM module handbook: 6');
    expect(text).toContain('ECTS acc. to CIT website (FPSO 2026): not listed');
    expect(text).toContain('Counted: 5 (FPSO 26)');
  });
  it('lists discrepancies of the selected courses only, each module once', () => {
    expect(creditNotes(data, emptyState())).toEqual([]);
    expect(creditNotes(data, { selected: [1], picks: {}, modules: [] })).toEqual([]);
    const n = creditNotes(data, { selected: [1, 2], picks: {}, modules: [] });
    expect(n.map((x) => x.module)).toEqual(['M2']);
    expect(n[0].catalog).toBe('bio');
  });
});

describe('catalog sources', () => {
  const m = { ...data.modules.M2, catalog: 'bio' as const, catalog_from: 'handbook' as const,
    catalog_sources: { pdf: null, handbook: ['bio' as const], web: 'cs' as const } };
  it('names every source and marks the one that decided', () => {
    const lines = catalogLines(m, data);
    expect(lines.map((l) => [l.label, l.used])).toEqual([
      ['FPSO published in July 2026', false], ['TUMonline website', true], ['CIT FPSO 2026 website', false]]);
    expect(lines[0].value).toBe('not listed');
  });
  it('flags only real disagreements', () => {
    expect(catalogConflict(m)).toBe(true);
    expect(catalogConflict({ ...m, catalog_sources: { pdf: null, handbook: ['bio'], web: 'bio' } })).toBe(false);
    expect(catalogConflict({ ...m, catalog_sources: { pdf: 'bio', handbook: [], web: null } })).toBe(false);
  });
});

describe('one-off dates of lectures', () => {
  const one = (day: number, start: string, end: string) => ({ ...slot(day, start, end), n: 1 });
  const lec = (slots: ReturnType<typeof slot>[], category: 'lecture' | 'seminar' = 'lecture') => ({ ...data.courses[0], category, slots });
  it('hides single dates of a lecture that also has a recurring pattern', () => {
    const c = lec([slot(3, '10:00', '12:00'), one(3, '10:00', '15:00')]);
    expect(gridSlots(c).map((x) => x.index)).toEqual([0]);
    expect(oneOffSlots(c)).toHaveLength(1);
  });
  it('keeps single dates of a lecture that has no recurring pattern', () => {
    const c = lec([one(3, '10:00', '12:00'), one(4, '10:00', '12:00')]);
    expect(gridSlots(c)).toHaveLength(2);
    expect(oneOffSlots(c)).toHaveLength(0);
  });
  it('does not change other course types', () => {
    const c = lec([slot(3, '10:00', '12:00'), one(3, '10:00', '15:00')], 'seminar');
    expect(gridSlots(c)).toHaveLength(2);
  });
  it('keeps the original slot index so keys stay stable', () => {
    const c = lec([one(5, '08:00', '09:00'), slot(3, '10:00', '12:00')]);
    expect(gridSlots(c).map((x) => x.index)).toEqual([1]);
  });
  it('a hidden one-off date causes no conflict', () => {
    const d2 = { ...data, courses: [{ ...data.courses[0], slots: [slot(1, '10:00', '12:00'), one(1, '15:00', '16:00')] },
      { ...data.courses[1], slots: [slot(1, '15:00', '16:00')] }] };
    expect(conflictKeys(committedBlocks(d2, { selected: [1, 2], picks: {}, modules: [] })).size).toBe(0);
  });
});

describe('hash of CIT modules', () => {
  it('round-trips the selected modules', () => {
    const state = { selected: [1], picks: {}, modules: ['C1', 'IN5022'] };
    const h = encodeHash({ view: 'main', state, showExercises: false });
    expect(h).toContain('m=C1%2CIN5022');
    expect(decodeHash(h).state.modules).toEqual(['C1', 'IN5022']);
  });
  it('leaves the parameter out when no module is selected and ignores junk', () => {
    expect(encodeHash({ view: 'main', state: emptyState(), showExercises: false })).not.toContain('m=');
    expect(decodeHash('#v=main&m=,%3Cb%3E,IN5022').state.modules).toEqual(['IN5022']);
  });
});

describe('hash', () => {
  it('round-trips state', () => {
    const h = { view: 'schedule' as const, state: { selected: [1, 22], picks: { 10: 'Group 10' }, modules: [] }, showExercises: true };
    expect(decodeHash(encodeHash(h))).toEqual(h);
  });
  it('ignores garbage', () => {
    const h = decodeHash('#v=nope&l=a,,-3,7&e=x:y;5:G');
    expect(h.view).toBe('main');
    expect(h.state.selected).toEqual([7]);
    expect(h.state.picks).toEqual({ 5: 'G' });
  });
});
