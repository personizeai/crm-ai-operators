/**
 * Add N business days to a date (skips Saturdays and Sundays).
 * Does not honor public holidays — operations that need that should layer their
 * own holiday calendar on top.
 */
export function addBusinessDays(date: Date, days: number): Date {
  if (days <= 0) return new Date(date);
  const result = new Date(date);
  let added = 0;
  while (added < days) {
    result.setDate(result.getDate() + 1);
    const day = result.getDay();
    if (day !== 0 && day !== 6) added++;
  }
  return result;
}

/** Format a Date as YYYY-MM-DD. */
export function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Current date as YYYY-MM-DD. */
export function todayIso(): string {
  return isoDate(new Date());
}
