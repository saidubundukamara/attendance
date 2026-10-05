const DAY_MS = 24 * 60 * 60 * 1000;

export function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value);
}

// Teaching week for `today`, counting the start date's week as week 1.
// Clamped to 1..totalWeeks; null when the class has no start date.
export function suggestWeek(
  startDate: string | null,
  today: Date,
  totalWeeks: number,
): number | null {
  if (!startDate || !isIsoDate(startDate)) return null;
  const start = Date.parse(`${startDate}T00:00:00Z`);
  // Compare calendar dates, ignoring the time of day.
  const current = Date.UTC(
    today.getFullYear(),
    today.getMonth(),
    today.getDate(),
  );
  const week = Math.floor((current - start) / DAY_MS / 7) + 1;
  return Math.min(Math.max(week, 1), Math.max(totalWeeks, 1));
}
