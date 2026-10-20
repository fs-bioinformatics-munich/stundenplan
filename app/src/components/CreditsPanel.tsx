import type { CatalogKey, ScheduleData } from '../lib/types';
import { creditsByCatalog, type AppState } from '../lib/selection';
import { creditNotes } from '../lib/credits';

const KEYS: CatalogKey[] = ['methods', 'cs', 'bio', 'interdisc'];

/** Credits collected per catalog; the swatches use the same colours as the lecture boxes (legend). */
export function CreditsPanel({ data, state, layout, legend = false }: { data: ScheduleData; state: AppState; layout: 'strip' | 'column'; legend?: boolean }) {
  const credits = creditsByCatalog(data, state);
  const notes = creditNotes(data, state);
  return (
    <div class={`credits ${layout}`} data-testid="credits">
      {KEYS.map((k) => {
        const info = data.catalogs[k];
        const have = credits[k];
        const done = have >= info.min;
        const over = info.max !== undefined && have > info.max;
        return (
          <div class="credit-row" data-testid={`credit-${k}`} key={k}>
            <span class={`swatch cat-${k}`} />
            <span class="credit-label">{info.label}</span>
            <span class={`credit-value ${done ? 'done' : ''} ${over ? 'over' : ''}`}>
              {have} / {info.min}{info.max !== undefined ? `–${info.max}` : ''}
              {done && !over ? ' ✓' : ''}{over ? ' (above max)' : ''}
              {notes.some((n) => n.catalog === k) && <span class="note-mark" title="Includes modules whose credit sources disagree, see the note below">*</span>}
            </span>
            <span class="bar"><span class={`fill cat-${k}`} style={{ width: `${Math.min(100, (have / info.min) * 100)}%` }} /></span>
          </div>
        );
      })}
      {credits.other > 0 && (
        <div class="credit-row" data-testid="credit-other">
          <span class="swatch cat-none" />
          <span class="credit-label">Not in a catalog</span>
          <span class="credit-value">{credits.other}</span>
        </div>
      )}
      {(notes.length > 0 || legend) && (
        <div class="credit-notes" data-testid="credit-notes">
          {notes.map((n) => <p><span class="note-mark">*</span> <strong>{n.module}</strong> {n.name}: {n.text}</p>)}
          {notes.length === 0 && <p><span class="note-mark">*</span> Credits differ between sources for some modules; hover the * or open the course for details.</p>}
        </div>
      )}
      <div class="credit-row total" data-testid="credit-total">
        <span class="credit-label">Elective modules total</span>
        <span class={`credit-value ${credits.total >= data.total_min ? 'done' : ''}`}>
          {credits.total} / {data.total_min}{credits.total >= data.total_min ? ' ✓' : ''}
          {notes.length > 0 && <span class="note-mark" title="Includes modules whose credit sources disagree, see the note below">*</span>}
        </span>
      </div>
    </div>
  );
}
