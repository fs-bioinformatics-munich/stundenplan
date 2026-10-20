import type { Category, Course, ScheduleData } from '../lib/types';
import type { AppState } from '../lib/selection';
import type { Filters } from '../lib/store';
import { fmtRange, toMin } from '../lib/time';
import { WeekGrid, type GridBox } from './WeekGrid';
import { CreditsPanel } from './CreditsPanel';
import { creditNote } from '../lib/credits';
import { gridSlots, oneOffSlots } from '../lib/slots';

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
        <span class="counter" data-testid="counter">{state.selected.length} selected</span>
        <button class="primary" disabled={!state.selected.length} onClick={props.onCreate} data-testid="create">Create schedule</button>
      </div>
      <div class="toolbar types" data-testid="types">
        {counts.map(([cat, n]) => (
          <label class={`chip tone-${cat}`}>
            <input
              type="checkbox"
              checked={filters.categories[cat]}
              onChange={() => setFilters({ ...filters, categories: { ...filters.categories, [cat]: !filters.categories[cat] } })}
            />
            {CATEGORY_LABELS[cat]} <span class="muted">{n}</span>
          </label>
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
    </section>
  );
}
