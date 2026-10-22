import { useEffect } from 'preact/hooks';
import type { ScheduleData } from '../lib/types';
import { citCreditNote } from '../lib/credits';

const CREDIT_FROM = { pdf: 'FPSO published in July 2026', handbook: 'TUMonline website', web: 'CIT FPSO 2026 website', module_pdf: 'CIT module description (PDF)', manual: 'hand correction' } as const;

/** Details of a CIT module that has a module description PDF but no TUMonline page: the fields read from that PDF. */
export function CitModulePopup({ data, id, onClose }: { data: ScheduleData; id: string | null; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  const m = id ? data.cit_modules.find((x) => x.id === id) : undefined;
  if (!m) return null;
  const hand = (field: string) => (m.manual_fields.includes(field) ? <span class="muted" title="corrected by hand in data/cit_modules_manual.json"> (hand-corrected)</span> : null);
  const w = m.workload;
  const hours = [w.presence !== null && `${w.presence} h contact`, w.self !== null && `${w.self} h self-study`, w.total !== null && `${w.total} h total`].filter(Boolean).join(' · ');
  const row = (label: string, value: string | null | undefined, field?: string) => value
    ? <><dt>{label}</dt><dd>{value}{field && hand(field)}</dd></>
    : null;
  return (
    <div class="overlay" onClick={onClose} data-testid="popup-overlay">
      <div class="popup" role="dialog" aria-modal="true" aria-label={m.name} onClick={(e) => e.stopPropagation()} data-testid="cit-popup">
        <button class="popup-close" onClick={onClose} aria-label="Close">×</button>
        <h2>{m.name}</h2>
        <p class="muted">{m.id} · module description only, no TUMonline course or dates</p>
        <dl>
          {row('Catalog', m.catalog ? data.catalogs[m.catalog].label : 'not in a catalog')}
          <dt>Credits</dt>
          <dd>
            {m.credits} ECTS ({CREDIT_FROM[m.credits_used_from ?? 'web']}){hand('credits')}
            {m.credits_conflict && (
              <div class="ects-note" data-testid="ects-note"><span class="note-mark">*</span> <strong>{citCreditNote(m)}</strong></div>
            )}
          </dd>
          {row('Type', m.type, 'type')}
          {row('Teaching', m.teaching_form, 'teaching_form')}
          {row('Language', m.language, 'language')}
          {row('Level', m.level, 'level')}
          {row('Workload', hours)}
          {row('Turnus', m.turnus, 'turnus')}
          {row('Responsible', m.responsible, 'responsible')}
          {row('Lecturers', m.lecturers.join('; '), 'lecturers')}
          <dt>Links</dt>
          <dd><a href={m.pdf_url} target="_blank" rel="noreferrer">Module description (PDF)</a></dd>
        </dl>
      </div>
    </div>
  );
}
