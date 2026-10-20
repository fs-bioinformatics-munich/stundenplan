import { useEffect } from 'preact/hooks';
import type { Course, Exercise, ScheduleData, Slot } from '../lib/types';
import { DAY_NAMES, fmtRange } from '../lib/time';
import { exercisesOf } from '../lib/selection';
import { creditLines } from '../lib/credits';
import { gridSlots, oneOffSlots } from '../lib/slots';

export type Opened = { kind: 'course' | 'exercise'; id: number } | null;

function slotLine(s: Slot): string {
  const dates = s.n === 1 ? s.first : `${s.first} to ${s.last}, ${s.n} dates`;
  return `${DAY_NAMES[s.day - 1]} ${fmtRange(s.start, s.end)} · ${s.room ?? 'room not set'} · ${dates}`;
}

export function CoursePopup({ data, opened, onClose }: { data: ScheduleData; opened: Opened; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  if (!opened) return null;
  const item: Course | Exercise | undefined = opened.kind === 'course'
    ? data.courses.find((c) => c.id === opened.id)
    : data.exercises.find((e) => e.id === opened.id);
  if (!item) return null;

  const isExercise = opened.kind === 'exercise';
  const slots: Slot[] = isExercise
    ? [...(item as Exercise).fixed_slots, ...(item as Exercise).groups.flatMap((g) => g.slots)]
    : (item as Course).slots;
  const regularSlots: Slot[] = isExercise ? slots : gridSlots(item as Course).map((x) => x.slot);
  const singleDates: Slot[] = isExercise ? [] : oneOffSlots(item as Course);
  const exercises = !isExercise ? exercisesOf(data, [item.id]) : [];
  const reg = item.registration;
  const head = item.lecturers.filter((l) => l.role === 'Head');
  const others = item.lecturers.filter((l) => l.role !== 'Head');

  return (
    <div class="overlay" onClick={onClose} data-testid="popup-overlay">
      <div class="popup" role="dialog" aria-modal="true" aria-label={item.label} onClick={(e) => e.stopPropagation()} data-testid="popup">
        <button class="popup-close" onClick={onClose} aria-label="Close">×</button>
        <h2>{item.label}</h2>
        <p class="muted">{item.type}{item.language ? ` · ${item.language}` : ''}</p>

        <dl>
          {item.modules.length > 0 && (
            <>
              <dt>Module</dt>
              <dd>
                {item.modules.map((m) => (
                  <div>
                    {m} {data.modules[m]?.name}{data.modules[m]?.ects ? ` · ${data.modules[m].ects} ECTS` : ''}
                    {data.modules[m]?.ects_conflict && <span class="note-mark">*</span>}
                    {data.modules[m]?.turnus ? ` · ${data.modules[m].turnus}` : ''}
                    {data.modules[m]?.ects_conflict && (
                      <div class="ects-note" data-testid="ects-note">
                        <span class="note-mark">*</span> <strong>Credits differ between sources</strong>
                        <ul>
                          {creditLines(data.modules[m]).map((l) => (
                            <li class={l.counted ? 'counted' : ''}>{l.label}: <strong>{l.value}</strong>{l.counted ? ' (counted)' : ''}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                ))}
              </dd>
            </>
          )}
          <dt>Lecturers</dt>
          <dd>
            {item.lecturers.length === 0 && 'not listed'}
            {head.length > 0 && <div><strong>{head.map((l) => l.name).join(', ')}</strong> (head)</div>}
            {others.length > 0 && <div>{others.map((l) => l.name).join(', ')}</div>}
          </dd>
          <dt>Dates</dt>
          <dd>
            {slots.length === 0 && 'no dates published yet'}
            {regularSlots.map((s) => <div>{slotLine(s)}{s.n < 5 ? ' (few dates, irregular)' : ''}</div>)}
          </dd>
          {singleDates.length > 0 && (
            <>
              <dt>Single dates</dt>
              <dd data-testid="single-dates">
                {singleDates.map((s) => <div>{slotLine(s)}</div>)}
                <div class="muted">Not drawn in the week grid (the lecture has a weekly pattern).</div>
              </dd>
            </>
          )}
          <dt>Registration</dt>
          <dd>
            <span class={`dot ${reg.open ? 'open' : 'closed'}`} /> {reg.info ?? reg.status ?? 'unknown'}
            {reg.url ? <> · <a href={reg.url} target="_blank" rel="noreferrer">Registration page</a></> : ' · no registration procedure'}
          </dd>
          <dt>Links</dt>
          <dd>
            {item.modules.map((m) => data.modules[m]?.url && (
              <div><a href={data.modules[m].url} target="_blank" rel="noreferrer">Module description {m}</a></div>
            ))}
            <div><a href={item.course_url} target="_blank" rel="noreferrer">Course page in TUMonline</a></div>
          </dd>
          {exercises.length > 0 && (
            <>
              <dt>Exercises</dt>
              <dd>{exercises.map((e) => <div>{e.label} · {e.groups.filter((g) => g.slots.length).length} of {e.groups.length} groups with dates</div>)}</dd>
            </>
          )}
        </dl>
      </div>
    </div>
  );
}
