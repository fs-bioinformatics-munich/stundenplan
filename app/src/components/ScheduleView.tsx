import type { ScheduleData, Slot } from '../lib/types';
import {
  committedBlocks, conflictKeys, conflictPairs, exercisesOf, lecturesWithoutPick, type AppState,
} from '../lib/selection';
import { fmtRange, toMin } from '../lib/time';
import { WeekGrid, type GridBox } from './WeekGrid';
import { CreditsPanel } from './CreditsPanel';
import { creditNote } from '../lib/credits';
import { gridSlots } from '../lib/slots';
import { toneOf } from './MainView';
import { exerciseBoxes } from './exerciseBoxes';

export function ScheduleView(props: {
  data: ScheduleData;
  state: AppState;
  showExercises: boolean;
  setShowExercises: (v: boolean) => void;
  onToggle: (id: number) => void;
  onPick: (exerciseId: number, group: string) => void;
  onOpenCourse: (id: number) => void;
  onOpenExercise: (id: number) => void;
  onToggleCit: (id: string) => void;
  onOpenCit: (id: string) => void;
  onBack: () => void;
}) {
  const { data, state, showExercises } = props;
  const selected = new Set(state.selected);
  const courses = data.courses.filter((c) => selected.has(c.id));
  const exercises = exercisesOf(data, state.selected);
  const blocks = committedBlocks(data, state);
  const conflicts = conflictKeys(blocks);
  const pairs = conflictPairs(blocks);
  const pending = lecturesWithoutPick(data, state);
  const citSelected = data.cit_modules.filter((m) => state.modules.includes(m.id));

  const box = (key: string, s: Slot, extra: Partial<GridBox> & Pick<GridBox, 'title' | 'tone' | 'checkable' | 'checked'>): GridBox => ({
    key, day: s.day, start: toMin(s.start), end: toMin(s.end), sub: fmtRange(s.start, s.end), conflict: conflicts.has(key),
    tooltip: s.room ?? undefined, ...extra,
  });

  const boxes: GridBox[] = courses.flatMap((c) => gridSlots(c).map(({ slot: s, index: i }) => box(`c${c.id}:${i}`, s, {
    title: c.label, tone: toneOf(c), checkable: true, checked: true,
    sub: c.ects ? `${fmtRange(s.start, s.end)} · ${c.ects} ECTS` : fmtRange(s.start, s.end),
    regOpen: c.registration.open, irregular: s.n < 5,
    creditNote: c.ects_conflict && c.credit_module ? creditNote(data.modules[c.credit_module]) : undefined,
    onOpen: () => props.onOpenCourse(c.id), onCheck: () => props.onToggle(c.id),
  })));

  if (showExercises) boxes.push(...exerciseBoxes(data, state, props));

  const noDateGroups = exercises.flatMap((e) => e.groups.filter((g) => g.slots.length === 0).map((g) => ({ e, g })));

  return (
    <section>
      <div class="toolbar">
        <button onClick={props.onBack} data-testid="back">← Back to all courses</button>
        <h2 class="inline">My schedule</h2>
        <span class="spacer" />
        <button
          class={showExercises ? 'primary on' : 'primary'}
          onClick={() => props.setShowExercises(!showExercises)}
          disabled={!exercises.length}
          title={exercises.length ? '' : 'None of the selected lectures has exercises'}
          data-testid="show-exercises"
        >
          {showExercises ? 'Hide exercises' : 'Show exercises'}
        </button>
      </div>
      <div class="schedule-layout">
        <WeekGrid boxes={boxes} emptyText="Nothing selected." />
        <aside class="summary" data-testid="summary">
          <h3>Summary</h3>
          <p>{courses.length} course{courses.length === 1 ? '' : 's'}{citSelected.length > 0 && ` + ${citSelected.length} without dates`}</p>
          <CreditsPanel data={data} state={state} layout="column" />
          <ul>
            {courses.map((c) => <li><a href="#" onClick={(e) => { e.preventDefault(); props.onOpenCourse(c.id); }}>{c.label}</a></li>)}
          </ul>
          {citSelected.length > 0 && (
            <>
              <h4>Modules without dates</h4>
              <ul data-testid="cit-selected">
                {citSelected.map((m) => (
                  <li>
                    <input type="checkbox" checked onChange={() => props.onToggleCit(m.id)} aria-label={`Deselect ${m.name}`} />{' '}
                    <a href="#" onClick={(e) => { e.preventDefault(); props.onOpenCit(m.id); }}>{m.name}</a> <span class="muted">{m.credits} ECTS</span>
                  </li>
                ))}
              </ul>
            </>
          )}
          {pairs.length > 0 && (
            <>
              <h4 class="warn">Conflicts</h4>
              <ul data-testid="conflicts">{pairs.map(([a, b]) => <li>{a.label} ↔ {b.label}</li>)}</ul>
            </>
          )}
          {showExercises && pending.length > 0 && (
            <>
              <h4>Exercise group still to pick</h4>
              <ul data-testid="pending">{pending.map((e) => <li>{e.label}</li>)}</ul>
            </>
          )}
          {showExercises && exercises.some((e) => state.picks[e.id]) && (
            <>
              <h4>Chosen groups</h4>
              <ul>{exercises.filter((e) => state.picks[e.id]).map((e) => <li>{e.label}: {state.picks[e.id]}</li>)}</ul>
            </>
          )}
          {showExercises && noDateGroups.length > 0 && (
            <details>
              <summary>{noDateGroups.length} exercise groups without dates</summary>
              <ul>{noDateGroups.map(({ e, g }) => <li>{e.label}: {g.name}</li>)}</ul>
            </details>
          )}
        </aside>
      </div>
    </section>
  );
}
