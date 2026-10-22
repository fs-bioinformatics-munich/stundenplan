import type { ScheduleData, Slot } from '../lib/types';
import { clashesWith, committedBlocks, conflictKeys, exercisesOf, groupState, selectableGroups, type AppState } from '../lib/selection';
import { fmtRange, toMin } from '../lib/time';
import type { GridBox } from './WeekGrid';

/** Grid boxes of the exercises of the selected lectures (fixed slots and selectable groups); used by both views. */
export function exerciseBoxes(
  data: ScheduleData,
  state: AppState,
  handlers: { onOpenExercise: (id: number) => void; onPick: (exerciseId: number, group: string) => void },
): GridBox[] {
  const blocks = committedBlocks(data, state);
  const conflicts = conflictKeys(blocks);
  const box = (key: string, s: Slot, extra: Partial<GridBox> & Pick<GridBox, 'title' | 'tone' | 'checkable' | 'checked' | 'sub'>): GridBox => ({
    key, day: s.day, start: toMin(s.start), end: toMin(s.end), conflict: conflicts.has(key), tooltip: s.room ?? undefined, ...extra,
  });
  const boxes: GridBox[] = [];
  for (const e of exercisesOf(data, state.selected)) {
    e.fixed_slots.forEach((s, i) => boxes.push(box(`f${e.id}:${i}`, s, {
      title: e.label, tone: 'fixed', checkable: false, checked: false, sub: `${fmtRange(s.start, s.end)} · all groups`,
      onOpen: () => handlers.onOpenExercise(e.id),
    })));
    for (const g of selectableGroups(e)) {
      const st = groupState(state, e.id, g.name);
      g.slots.forEach((s, i) => boxes.push(box(`g${e.id}:${g.name}:${i}`, s, {
        title: e.label, sub: `${fmtRange(s.start, s.end)} · ${g.name}`, tone: 'exercise', checkable: true, checked: st === 'chosen', disabled: st === 'disabled',
        clash: st === 'free' && clashesWith(blocks, s), regOpen: e.registration.open,
        tooltip: st === 'disabled' ? `Another group of this exercise is already chosen` : (s.room ?? undefined),
        onOpen: () => handlers.onOpenExercise(e.id), onCheck: () => handlers.onPick(e.id, g.name),
      })));
    }
  }
  return boxes;
}
