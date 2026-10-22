import type { Category, Course, ScheduleData } from '../lib/types';
import { exercisesOf, type AppState } from '../lib/selection';
import type { Filters } from '../lib/store';
import { fmtRange, toMin } from '../lib/time';
import { WeekGrid, type GridBox } from './WeekGrid';
import { CreditsPanel } from './CreditsPanel';
import { citCreditNote, creditNote } from '../lib/credits';
import { gridSlots, oneOffSlots } from '../lib/slots';
import { exerciseBoxes } from './exerciseBoxes';

const CATEGORY_LABELS: Record<Category, string> = {
  lecture: 'Lectures (VO, VI)',
  seminar: 'Seminars (SE)',
  practical: 'Practicals (PR)',
  research: 'Research (FO)',
  workshop: 'Workshops (WS)',
  language: 'Language courses',
};
const ORDER: Category[] = ['lecture', 'seminar', 'practical', 'research', 'workshop', 'language'];

/** Lectures are coloured by their catalog, all other course types by type. */
export const toneOf = (c: Course): string => (c.category === 'lecture' ? `cat-${c.catalog ?? 'none'}` : c.category);
const ects = (c: Course): boolean => c.ects !== null && c.ects !== undefined;

export function matches(c: Course, data: ScheduleData, f: Filters): boolean {
  if (!f.categories[c.category]) return false;
  if (f.regOpen && !c.registration.open) return false;
  const q = f.query.trim().toLowerCase();
  if (!q) return true;
  const hay = [c.title, c.label, ...c.modules, ...c.modules.map((m) => data.modules[m]?.name ?? ''), ...c.lecturers.map((l) => l.name)]
    .join(' ').toLowerCase();
  return q.split(/\s+/).every((t) => hay.includes(t));
}

export function MainView(props: {
  data: ScheduleData;
  state: AppState;
  filters: Filters;
  setFilters: (f: Filters) => void;
  onToggle: (id: number) => void;
  onOpen: (id: number) => void;
  onCreate: () => void;
  onToggleCit: (id: string) => void;
  onOpenCit: (id: string) => void;
  showExercises: boolean;
  setShowExercises: (v: boolean) => void;
  onOpenExercise: (id: number) => void;
  onPick: (exerciseId: number, group: string) => void;
}) {
  const { data, state, filters, setFilters } = props;
  const selected = new Set(state.selected);
  const visible = data.courses.filter((c) => matches(c, data, filters));
  const counts = ORDER.map((cat) => [cat, data.courses.filter((c) => c.category === cat).length] as const);

  const boxes: GridBox[] = visible.flatMap((c) => gridSlots(c).map(({ slot: s, index: i }) => ({
    key: `c${c.id}:${i}`,
    day: s.day,
    start: toMin(s.start),
    end: toMin(s.end),
    title: c.label,
    sub: ects(c) ? `${fmtRange(s.start, s.end)} · ${c.ects} ECTS` : fmtRange(s.start, s.end),
    tone: toneOf(c),
    checkable: true,
    checked: selected.has(c.id),
    regOpen: c.registration.open,
    irregular: s.n < 5,
    creditNote: c.ects_conflict && c.credit_module ? creditNote(data.modules[c.credit_module]) : undefined,
    tooltip: `${c.label}${s.room ? ' · ' + s.room : ''}${oneOffSlots(c).length ? ` · plus ${oneOffSlots(c).length} single date(s), see details` : ''}`,
    onOpen: () => props.onOpen(c.id),
    onCheck: () => props.onToggle(c.id),
  })));
  const hasExercises = exercisesOf(data, state.selected).length > 0;
  if (props.showExercises) boxes.push(...exerciseBoxes(data, state, props));
  const q = filters.query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const citVisible = data.cit_modules.filter((m) => {
    const hay = [m.name, m.id, m.title ?? '', ...m.lecturers].join(' ').toLowerCase();
    return q.every((t) => hay.includes(t));
  });
  const undated = visible.filter((c) => c.slots.length === 0);

  return (
    <section>
      <div class="toolbar">
        <input
          type="search"
          placeholder="Search title, module id, lecturer"
          value={filters.query}
          onInput={(e) => setFilters({ ...filters, query: (e.target as HTMLInputElement).value })}
          aria-label="Search"
        />
        <label class="chip">
          <input type="checkbox" checked={filters.regOpen} onChange={() => setFilters({ ...filters, regOpen: !filters.regOpen })} />
          Registration open
        </label>
        <span class="spacer" />
        <span class="counter" data-testid="counter">{state.selected.length + state.modules.length} selected</span>
        <button class="primary" disabled={!state.selected.length && !state.modules.length} onClick={props.onCreate} data-testid="create">Create schedule</button>
      </div>
      <div class="toolbar types" data-testid="types">
        {counts.map(([cat, n]) => (
          <>
          <label class={`chip tone-${cat}`}>
            <input
              type="checkbox"
              checked={filters.categories[cat]}
              onChange={() => setFilters({ ...filters, categories: { ...filters.categories, [cat]: !filters.categories[cat] } })}
            />
            {CATEGORY_LABELS[cat]} <span class="muted">{n}</span>
          </label>
          {cat === 'lecture' && (
            <button
              class={props.showExercises ? 'primary on' : 'primary'}
              onClick={() => props.setShowExercises(!props.showExercises)}
              disabled={!hasExercises}
              title={hasExercises ? 'Show the exercise groups of the selected lectures' : 'Select a lecture that has exercises first'}
              data-testid="show-exercises"
            >
              {props.showExercises ? 'Hide exercises' : 'Show exercises'}
            </button>
          )}
          </>
        ))}
      </div>
      <CreditsPanel data={data} state={state} layout="strip" legend={boxes.some((b) => b.creditNote)} />
      <WeekGrid boxes={boxes} emptyText="No courses match the filters." />
      {undated.length > 0 && (
        <div class="undated" data-testid="undated">
          <h3>No dates published yet</h3>
          <ul>
            {undated.map((c) => (
              <li>
                <input type="checkbox" checked={selected.has(c.id)} onChange={() => props.onToggle(c.id)} aria-label={`Select ${c.label}`} />
                <a href="#" onClick={(e) => { e.preventDefault(); props.onOpen(c.id); }}>{c.label}</a>
              </li>
            ))}
          </ul>
        </div>
      )}
      {citVisible.length > 0 && (
        <div class="undated cit-modules" data-testid="cit-modules">
          <h3>Modules from the CIT catalog without TUMonline course ({citVisible.length})</h3>
          <p class="muted">Only a module description PDF exists, so there are no dates. They can be selected anyway and count towards the credits.</p>
          <ul>
            {citVisible.map((m) => (
              <li data-testid={`cit-${m.id}`}>
                <input type="checkbox" checked={state.modules.includes(m.id)} onChange={() => props.onToggleCit(m.id)} aria-label={`Select ${m.name}`} />
                <span class={`swatch cat-${m.catalog ?? 'none'}`} />
                <a href="#" onClick={(e) => { e.preventDefault(); props.onOpenCit(m.id); }}>{m.name}</a>
                <span class="muted"> {m.id} · {m.credits} ECTS</span>
                {m.credits_conflict && <span class="note-mark" title={citCreditNote(m)}>*</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
