import type { CatalogKey, ModuleInfo, ScheduleData } from './types';
import type { AppState } from './selection';

export const SOURCE_LABELS = {
  pdf: 'ECTS acc. to FPSO 26',
  handbook: 'ECTS acc. to TUM module handbook',
  web: 'ECTS acc. to CIT website (2021 rules)',
} as const;
const SOURCE_SHORT = { pdf: 'FPSO 26', handbook: 'TUM module handbook', web: 'CIT website' } as const;

export interface CreditLine { label: string; value: string; counted: boolean }

/** One line per source: its label, its value ("not listed" if absent) and whether it is the value counted. */
export function creditLines(m: ModuleInfo): CreditLine[] {
  return (['pdf', 'handbook', 'web'] as const).map((k) => ({
    label: SOURCE_LABELS[k],
    value: m.ects_sources[k] === null ? 'not listed' : String(m.ects_sources[k]),
    counted: m.ects_used_from === k,
  }));
}

/** Text for a module whose credit sources disagree (box tooltip, credits footnote). */
export function creditNote(m: ModuleInfo): string {
  const lines = creditLines(m).map((l) => `${l.label}: ${l.value}`).join('; ');
  const from = m.ects_used_from ? SOURCE_SHORT[m.ects_used_from] : 'no source';
  return `Credits differ between sources: ${lines}. Counted: ${m.ects ?? '?'} (${from}).`;
}

export interface CreditNote { module: string; name: string; text: string; catalog: CatalogKey | null }

/** Credit discrepancies of the selected courses (each module once). */
export function creditNotes(data: ScheduleData, state: AppState): CreditNote[] {
  const selected = new Set(state.selected);
  const seen = new Set<string>();
  const notes: CreditNote[] = [];
  for (const c of data.courses) {
    const m = c.credit_module ? data.modules[c.credit_module] : undefined;
    if (!selected.has(c.id) || !c.credit_module || !m?.ects_conflict || seen.has(c.credit_module)) continue;
    seen.add(c.credit_module);
    notes.push({ module: c.credit_module, name: m.name, text: creditNote(m), catalog: c.catalog });
  }
  return notes;
}
