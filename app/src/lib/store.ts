import type { Category } from './types';
import { emptyState, type AppState } from './selection';

export type View = 'main' | 'schedule';

export interface HashState { view: View; state: AppState; showExercises: boolean }

export interface Filters {
  categories: Record<Category, boolean>;
  regOpen: boolean;
  query: string;
}

export const defaultFilters = (): Filters => ({
  categories: { lecture: true, seminar: false, practical: false, research: false, workshop: false, language: false },
  regOpen: false,
  query: '',
});

/** #v=schedule&l=1,2&m=IN5022,CIT802000&e=3:Group%2010;4:Group%202&x=1 */
export function encodeHash(h: HashState): string {
  const p = new URLSearchParams();
  p.set('v', h.view);
  if (h.state.selected.length) p.set('l', h.state.selected.join(','));
  const picks = Object.entries(h.state.picks).map(([id, g]) => `${id}:${g}`);
  if (picks.length) p.set('e', picks.join(';'));
  if (h.state.modules.length) p.set('m', h.state.modules.join(','));
  if (h.showExercises) p.set('x', '1');
  return '#' + p.toString();
}

export function decodeHash(hash: string): HashState {
  const p = new URLSearchParams(hash.replace(/^#/, ''));
  const state = emptyState();
  state.selected = (p.get('l') ?? '').split(',').map(Number).filter((n) => Number.isInteger(n) && n > 0);
  state.modules = (p.get('m') ?? '').split(',').filter((id) => /^[A-Za-z0-9_-]{2,24}$/.test(id));
  for (const part of (p.get('e') ?? '').split(';')) {
    const i = part.indexOf(':');
    const id = Number(part.slice(0, i));
    if (i > 0 && Number.isInteger(id)) state.picks[id] = part.slice(i + 1);
  }
  return { view: p.get('v') === 'schedule' ? 'schedule' : 'main', state, showExercises: p.get('x') === '1' };
}

const KEY = 'stundenplan.v1';

// localStorage can throw (private mode, blocked site data): every access is guarded.
export function loadSaved(): { state: AppState; filters: Filters } | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const v = JSON.parse(raw);
    return { state: { ...emptyState(), ...v.state }, filters: { ...defaultFilters(), ...v.filters } };
  } catch {
    return null;
  }
}

export function save(state: AppState, filters: Filters): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ state, filters }));
  } catch {
    /* ignore */
  }
}
