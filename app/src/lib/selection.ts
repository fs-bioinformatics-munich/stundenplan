import type { Course, Exercise, ExerciseGroup, ScheduleData, Slot } from './types';
import { overlaps, toMin } from './time';
import { gridSlots } from './slots';

export interface AppState {
  selected: number[]; // course ids
  picks: Record<number, string>; // exercise id -> chosen group name
}

export const emptyState = (): AppState => ({ selected: [], picks: {} });

export type GroupState = 'free' | 'chosen' | 'disabled';

export function toggleCourse(state: AppState, id: number): AppState {
  const selected = state.selected.includes(id) ? state.selected.filter((x) => x !== id) : [...state.selected, id];
  return { ...state, selected };
}

/** Picking a group chooses it; picking the chosen group again releases the choice. */
export function pickGroup(state: AppState, exerciseId: number, group: string): AppState {
  const picks = { ...state.picks };
  if (picks[exerciseId] === group) delete picks[exerciseId];
  else picks[exerciseId] = group;
  return { ...state, picks };
}

export function groupState(state: AppState, exerciseId: number, group: string): GroupState {
  const chosen = state.picks[exerciseId];
  if (chosen === undefined) return 'free';
  return chosen === group ? 'chosen' : 'disabled';
}

export function exercisesOf(data: ScheduleData, lectureIds: number[]): Exercise[] {
  const set = new Set(lectureIds);
  return data.exercises.filter((e) => e.lecture_ids.some((l) => set.has(l)));
}

export function selectableGroups(e: Exercise): ExerciseGroup[] {
  return e.groups.filter((g) => g.slots.length > 0);
}

export function lecturesWithoutPick(data: ScheduleData, state: AppState): Exercise[] {
  return exercisesOf(data, state.selected).filter((e) => selectableGroups(e).length > 0 && state.picks[e.id] === undefined);
}

export interface Block { key: string; label: string; day: number; start: number; end: number }

const block = (key: string, label: string, s: Slot): Block => ({ key, label, day: s.day, start: toMin(s.start), end: toMin(s.end) });

/** Everything that is committed in the plan: selected courses, fixed exercise slots, chosen groups. */
export function committedBlocks(data: ScheduleData, state: AppState): Block[] {
  const blocks: Block[] = [];
  const selected = new Set(state.selected);
  for (const c of data.courses) {
    if (!selected.has(c.id)) continue;
    gridSlots(c).forEach(({ slot, index }) => blocks.push(block(`c${c.id}:${index}`, c.label, slot)));
  }
  for (const e of exercisesOf(data, state.selected)) {
    e.fixed_slots.forEach((s, i) => blocks.push(block(`f${e.id}:${i}`, e.label, s)));
    const chosen = e.groups.find((g) => g.name === state.picks[e.id]);
    chosen?.slots.forEach((s, i) => blocks.push(block(`g${e.id}:${chosen.name}:${i}`, `${e.label} (${chosen.name})`, s)));
  }
  return blocks;
}

export function conflictPairs(blocks: Block[]): [Block, Block][] {
  const pairs: [Block, Block][] = [];
  for (let i = 0; i < blocks.length; i++)
    for (let j = i + 1; j < blocks.length; j++)
      if (blocks[i].day === blocks[j].day && overlaps(blocks[i], blocks[j])) pairs.push([blocks[i], blocks[j]]);
  return pairs;
}

export function conflictKeys(blocks: Block[]): Set<string> {
  const keys = new Set<string>();
  for (const [a, b] of conflictPairs(blocks)) { keys.add(a.key); keys.add(b.key); }
  return keys;
}

/** Would this slot clash with something already committed? (used for not-yet-chosen groups) */
export function clashesWith(blocks: Block[], s: Slot): boolean {
  const b = { start: toMin(s.start), end: toMin(s.end) };
  return blocks.some((x) => x.day === s.day && overlaps(x, b));
}

export interface Credits {
  methods: number;
  cs: number;
  bio: number;
  interdisc: number;
  other: number; // selected modules that are in none of the four catalogs
  total: number; // the four catalogs together (what counts towards the elective minimum)
}

/** Credits of the selected courses per catalog. Each module counts once, through the course's credit_module. */
export function creditsByCatalog(data: ScheduleData, state: AppState): Credits {
  const selected = new Set(state.selected);
  const seen = new Set<string>();
  const out: Credits = { methods: 0, cs: 0, bio: 0, interdisc: 0, other: 0, total: 0 };
  for (const c of data.courses) {
    if (!selected.has(c.id) || !c.credit_module || seen.has(c.credit_module)) continue;
    seen.add(c.credit_module);
    const ects = data.modules[c.credit_module]?.ects ?? 0;
    out[c.catalog ?? 'other'] += ects;
    if (c.catalog) out.total += ects;
  }
  return out;
}

export const ectsSum = (data: ScheduleData, state: AppState): number => {
  const c = creditsByCatalog(data, state);
  return c.total + c.other;
};

export function courseById(data: ScheduleData, id: number): Course | undefined {
  return data.courses.find((c) => c.id === id);
}
