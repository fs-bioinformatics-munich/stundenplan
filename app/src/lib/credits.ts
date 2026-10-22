import type { CatalogKey, CitModule, ModuleInfo, ScheduleData } from './types';
import type { AppState } from './selection';

export const SOURCE_LABELS = {
  pdf: 'ECTS acc. to FPSO 26',
  handbook: 'ECTS acc. to TUM module handbook',
  web: 'ECTS acc. to CIT website (FPSO 2026)',
} as const;
const SOURCE_SHORT = { pdf: 'FPSO 26', handbook: 'TUM module handbook', web: 'CIT website', module_pdf: 'CIT module description', manual: 'hand correction' } as const;
const MODULE_PDF_LABEL = 'ECTS acc. to CIT module description (PDF)';

/** How the catalog sources are named next to a module's catalog. */
export const CATALOG_SOURCE_LABELS = {
  pdf: 'FPSO published in July 2026',
  handbook: 'TUMonline website',
  web: 'CIT FPSO 2026 website',
} as const;

export interface CatalogLine { source: keyof typeof CATALOG_SOURCE_LABELS; label: string; value: string; used: boolean }

/** One line per source with the catalog it names ("not listed" if absent) and whether it decided. */
export function catalogLines(m: ModuleInfo, data: ScheduleData): CatalogLine[] {
  const name = (k: CatalogKey) => data.catalogs[k]?.label ?? k;
  return (['pdf', 'handbook', 'web'] as const).map((k) => {
    const v = m.catalog_sources[k];
    const keys = v === null ? [] : Array.isArray(v) ? v : [v];
    return { source: k, label: CATALOG_SOURCE_LABELS[k], value: keys.length ? keys.map(name).join(' + ') : 'not listed', used: m.catalog_from === k };
  });
}

/** The sources name different catalogs (a "not listed" is not a disagreement). */
export function catalogConflict(m: ModuleInfo): boolean {
  const all = [m.catalog_sources.pdf, ...m.catalog_sources.handbook, m.catalog_sources.web].filter((x) => x !== null);
  return new Set(all).size > 1;
}

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

/** Credit note of a CIT module whose sources (including its description PDF) disagree. */
export function citCreditNote(m: CitModule): string {
  const s = m.credits_sources;
  const v = (x: number | null) => (x === null ? 'not listed' : String(x));
  const lines = [`${SOURCE_LABELS.pdf}: ${v(s.pdf)}`, `${SOURCE_LABELS.handbook}: ${v(s.handbook)}`, `${SOURCE_LABELS.web}: ${v(s.web)}`, `${MODULE_PDF_LABEL}: ${v(s.module_pdf)}`];
  const from = m.credits_used_from ? SOURCE_SHORT[m.credits_used_from] : 'no source';
  return `Credits differ between sources: ${lines.join('; ')}. Counted: ${m.credits} (${from}).`;
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
  for (const m of data.cit_modules) {
    if (!state.modules.includes(m.id) || !m.credits_conflict || seen.has(m.id)) continue;
    seen.add(m.id);
    notes.push({ module: m.id, name: m.name, text: citCreditNote(m), catalog: m.catalog });
  }
  return notes;
}
