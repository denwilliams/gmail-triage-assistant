import { useEffect, useRef, useState } from 'react';
import type { EmailsResponse, RangeId } from './types';
import { Icon } from './icons';

export const RANGE_GROUPS: { label: string; items: { id: RangeId; label: string }[] }[] = [
  {
    label: 'Calendar',
    items: [
      { id: 'day', label: 'Day' },
      { id: 'week', label: 'Week' },
      { id: 'month', label: 'Month' },
    ],
  },
  {
    label: 'Rolling',
    items: [
      { id: '24h', label: 'Last 24 hours' },
      { id: '7d', label: 'Last 7 days' },
      { id: '28d', label: 'Last 28 days' },
    ],
  },
];

export function rangeTitle(range: RangeId, data: EmailsResponse | null): string {
  if (range === '24h') return 'Last 24 hours';
  if (range === '7d') return 'Last 7 days';
  if (range === '28d') return 'Last 28 days';
  if (!data?.anchor) return 'Today';
  const anchorDate = new Date(`${data.anchor}T12:00:00Z`);
  if (range === 'day') {
    return data.anchor === data.today
      ? 'Today'
      : anchorDate.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  }
  if (range === 'week') {
    const todayWeekContains = data.today >= data.anchor && data.today < shift(data.anchor, 7);
    return todayWeekContains ? 'This week' : `Week of ${anchorDate.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`;
  }
  // month
  const sameMonth = data.today.slice(0, 7) === data.anchor.slice(0, 7);
  return sameMonth
    ? 'This month'
    : anchorDate.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
}

function shift(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function rangeSpan(data: EmailsResponse | null): string {
  if (!data) return '';
  const fmt = (iso: string) =>
    new Date(iso).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      timeZone: data.timezone,
    });
  if (data.range === 'day') {
    return new Date(data.start).toLocaleDateString(undefined, {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      timeZone: data.timezone,
    });
  }
  // end is exclusive — show the last included instant.
  const endShown = new Date(new Date(data.end).getTime() - 60_000).toISOString();
  return `${fmt(data.start)} – ${fmt(endShown)}`;
}

export function RangePicker({
  title,
  range,
  onSelect,
  children,
}: {
  title: string;
  range: RangeId;
  onSelect: (r: RangeId) => void;
  children?: React.ReactNode; // the subtitle line
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (ev: MouseEvent) => {
      if (!wrapRef.current?.contains(ev.target as Node)) setOpen(false);
    };
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, [open]);

  return (
    <div className="range-wrap" ref={wrapRef}>
      <button className="range-btn" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <h1>{title}</h1>
        {Icon.chevronDown('chevd')}
      </button>
      {children}
      {open && (
        <div className="range-menu" role="menu">
          {RANGE_GROUPS.map((g) => (
            <div key={g.label}>
              <div className="grp">{g.label}</div>
              {g.items.map((item) => (
                <button
                  key={item.id}
                  className={range === item.id ? 'on' : ''}
                  role="menuitem"
                  onClick={() => {
                    setOpen(false);
                    onSelect(item.id);
                  }}
                >
                  <span className="tick">{Icon.check()}</span>
                  {item.label}
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
