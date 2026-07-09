// Timezone-aware date helpers shared by user-facing views.
//
// D1 stores processed_at as UTC ISO strings; user-facing windows ("today",
// "this week") are defined in env.TIMEZONE. These convert between the two.

export function isValidDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

export function shiftDate(date: string, deltaDays: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + deltaDays);
  return d.toISOString().slice(0, 10);
}

// Wall-clock parts of `instant` viewed in tz, returned as a "fake UTC" epoch
// (i.e. Date.UTC of the local Y/M/D/h/m/s). The difference vs the real UTC
// epoch of `instant` is the tz offset at that instant.
function tzWallclockUTC(instant: Date, tz: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(instant);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '0';
  let hour = parseInt(get('hour'), 10);
  if (hour === 24) hour = 0;
  return Date.UTC(
    parseInt(get('year'), 10),
    parseInt(get('month'), 10) - 1,
    parseInt(get('day'), 10),
    hour,
    parseInt(get('minute'), 10),
    parseInt(get('second'), 10),
  );
}

// Convert a local-date (YYYY-MM-DD) in tz to the UTC instant when that day
// starts. Iterates once to absorb DST transitions.
export function localDateStartUTC(date: string, tz: string): Date {
  const localMidnightAsUtc = Date.UTC(
    parseInt(date.slice(0, 4), 10),
    parseInt(date.slice(5, 7), 10) - 1,
    parseInt(date.slice(8, 10), 10),
  );
  const offset0 = tzWallclockUTC(new Date(localMidnightAsUtc), tz) - localMidnightAsUtc;
  const guess1 = localMidnightAsUtc - offset0;
  const offset1 = tzWallclockUTC(new Date(guess1), tz) - guess1;
  return new Date(localMidnightAsUtc - offset1);
}

/** "Today" in tz expressed as YYYY-MM-DD. */
export function todayInTZ(tz: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** ISO weekday of a local date, 1 = Monday … 7 = Sunday. */
export function isoWeekday(date: string): number {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay(); // 0 = Sunday
  return day === 0 ? 7 : day;
}
