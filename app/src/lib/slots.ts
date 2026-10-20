import type { Course, Slot } from './types';

export interface IndexedSlot { slot: Slot; index: number }

/**
 * A lecture with a recurring pattern (some slot with several occurrences) does not draw its one-off
 * dates (e.g. a single exam appointment); they are listed in the popup. Lectures that only have
 * single dates, and all other course types, keep every slot. Indices refer to course.slots.
 */
export function hasRecurring(c: Course): boolean {
  return c.slots.some((s) => s.n >= 2);
}

export function gridSlots(c: Course): IndexedSlot[] {
  const hideOneOff = c.category === 'lecture' && hasRecurring(c);
  return c.slots.map((slot, index) => ({ slot, index })).filter(({ slot }) => !(hideOneOff && slot.n === 1));
}

export function oneOffSlots(c: Course): Slot[] {
  const grid = new Set(gridSlots(c).map((x) => x.index));
  return c.slots.filter((_, i) => !grid.has(i));
}
