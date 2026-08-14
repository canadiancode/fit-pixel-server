/**
 * App-day key (YYYY-MM-DD) from an instant + stored boundary.
 * Mirrors one-rep-max/lib/db/day-boundary/day-key.ts — do not trust client dayKey.
 */

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

export function formatDayKeyInTimeZone(date: Date, timeZone: string): string {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(date);

    const year = parts.find((part) => part.type === "year")?.value;
    const month = parts.find((part) => part.type === "month")?.value;
    const day = parts.find((part) => part.type === "day")?.value;

    if (year && month && day) {
      return `${year}-${month}-${day}`;
    }
  } catch {
    // Invalid timeZone — fall through to UTC.
  }

  const year = date.getUTCFullYear();
  const month = pad2(date.getUTCMonth() + 1);
  const day = pad2(date.getUTCDate());
  return `${year}-${month}-${day}`;
}

export function getLocalDayKey(
  date: Date,
  dayStartsAtMinutes: number,
  timeZone: string,
): string {
  const shifted = new Date(date.getTime() - dayStartsAtMinutes * 60_000);
  return formatDayKeyInTimeZone(shifted, timeZone);
}
