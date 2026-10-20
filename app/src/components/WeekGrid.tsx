import { assignLanes, maxLanesPerDay } from '../lib/layout';
import { DAY_NAMES } from '../lib/time';

export interface GridBox {
  key: string;
  day: number; // 1 = Monday
  start: number; // minutes since midnight
  end: number;
  title: string;
  sub: string; // time / group line
  tone: string; // css tone: lecture | seminar | ... | exercise | fixed
  checkable: boolean;
  checked: boolean;
  disabled?: boolean; // greyed out (sibling of a chosen exercise group)
  conflict?: boolean; // overlaps another committed box
  clash?: boolean; // would overlap something committed
  regOpen?: boolean | null; // registration dot, null = no dot
  irregular?: boolean; // few dates
  creditNote?: string; // credit sources disagree: shows a * with this text
  tooltip?: string;
  onOpen?: () => void;
  onCheck?: () => void;
}

const PPM = 1.1; // pixels per minute
const LANE_W = 170; // minimum lane width in px
const MIN_DAY_W = 190;

export function WeekGrid({ boxes, emptyText }: { boxes: GridBox[]; emptyText: string }) {
  const placements = assignLanes(boxes);
  const lanesPerDay = maxLanesPerDay(boxes, placements);
  const startH = Math.min(8, ...boxes.map((b) => Math.floor(b.start / 60)));
  const endH = Math.max(20, ...boxes.map((b) => Math.ceil(b.end / 60)));
  const lastDay = Math.max(5, ...boxes.map((b) => b.day));
  const days = Array.from({ length: lastDay }, (_, i) => i + 1);
  const bodyH = (endH - startH) * 60 * PPM;
  const hours = Array.from({ length: endH - startH }, (_, i) => startH + i);

  return (
    <div class="grid-scroll" data-testid="grid">
      {!boxes.length && <p class="grid-empty">{emptyText}</p>}
      <div class="grid">
        <div class="axis">
          <div class="day-head axis-head" />
          <div class="axis-body" style={{ height: `${bodyH}px` }}>
            {hours.map((h) => (
              <div class="hour-label" style={{ top: `${(h - startH) * 60 * PPM}px` }}>{String(h).padStart(2, '0')}:00</div>
            ))}
          </div>
        </div>
        {days.map((d) => {
          const width = Math.max(MIN_DAY_W, (lanesPerDay.get(d) ?? 1) * LANE_W);
          return (
            <div class="day" style={{ width: `${width}px` }} data-day={d}>
              <div class="day-head">{DAY_NAMES[d - 1]}</div>
              <div class="day-body" style={{ height: `${bodyH}px` }}>
                {hours.map((h) => <div class="hour-line" style={{ top: `${(h - startH) * 60 * PPM}px` }} />)}
                {boxes.filter((b) => b.day === d).map((b) => {
                  const p = placements.get(b.key)!;
                  const cls = ['box', `tone-${b.tone}`, b.checked && 'checked', b.disabled && 'disabled', b.conflict && 'conflict', b.clash && 'clash']
                    .filter(Boolean).join(' ');
                  const open = () => !b.disabled && b.onOpen?.();
                  return (
                    <div
                      class={cls}
                      role="button"
                      tabIndex={b.disabled ? -1 : 0}
                      aria-disabled={b.disabled ? 'true' : undefined}
                      title={b.tooltip}
                      data-key={b.key}
                      style={{
                        top: `${(b.start - startH * 60) * PPM}px`,
                        height: `${(b.end - b.start) * PPM - 2}px`,
                        left: `calc(${(p.lane / p.lanes) * 100}% + 2px)`,
                        width: `calc(${100 / p.lanes}% - 4px)`,
                      }}
                      onClick={open}
                      onKeyDown={(e) => { if (e.key === 'Enter') open(); }}
                    >
                      {b.checkable && (
                        <input
                          type="checkbox"
                          class="box-check"
                          checked={b.checked}
                          disabled={b.disabled}
                          aria-label={`Select ${b.title}`}
                          onClick={(e) => e.stopPropagation()}
                          onChange={() => b.onCheck?.()}
                        />
                      )}
                      <div class="box-title">
                        {b.regOpen !== null && b.regOpen !== undefined && (
                          <span class={`dot ${b.regOpen ? 'open' : 'closed'}`} title={b.regOpen ? 'Registration open' : 'Registration closed'} />
                        )}
                        {b.title}
                      </div>
                      <div class="box-sub">
                        {b.sub}
                        {b.creditNote && <span class="note-mark" title={b.creditNote} aria-label={b.creditNote}>*</span>}
                        {b.irregular ? ' · few dates' : ''}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
