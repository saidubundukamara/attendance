// Deadlines are typed and shown in the college's local time, whatever time
// zone the server runs in. Safe to import from client components.

export const DEFAULT_TIMEZONE = "Africa/Freetown";

// Server only: the client gets the value passed down as a prop.
export function appTimeZone(): string {
  return process.env.APP_TIMEZONE || DEFAULT_TIMEZONE;
}

function wallClockParts(ms: number, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(ms));
  const get = (type: string) =>
    Number(parts.find((part) => part.type === type)?.value ?? 0);
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour"),
    minute: get("minute"),
    second: get("second"),
  };
}

// How far the zone's wall clock is ahead of UTC at the instant `ms`.
function zoneOffsetMs(ms: number, timeZone: string): number {
  const p = wallClockParts(ms, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(ms / 1000) * 1000;
}

const LOCAL_INPUT = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

// "2026-10-30T23:59" (a datetime-local value) in `timeZone` -> Unix ms.
// Null when the text is not a real date and time.
export function localInputToMs(value: string, timeZone: string): number | null {
  const match = LOCAL_INPUT.exec(value.trim());
  if (!match) return null;
  const [year, month, day, hour, minute] = match.slice(1).map(Number);
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  const check = new Date(guess);
  if (
    check.getUTCMonth() !== month - 1 ||
    check.getUTCDate() !== day ||
    hour > 23 ||
    minute > 59
  ) {
    return null;
  }
  // Correct once more in case the first guess crossed a DST change.
  const first = guess - zoneOffsetMs(guess, timeZone);
  return guess - zoneOffsetMs(first, timeZone);
}

// Unix ms -> "2026-10-30T23:59" for a datetime-local input's value.
export function msToLocalInput(ms: number, timeZone: string): string {
  const p = wallClockParts(ms, timeZone);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}`;
}

// "Fri 30 Oct, 23:59"
export function formatDeadline(ms: number, timeZone: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(ms));
}

// "30 Oct 23:59", as written into the submissions sheet.
export function formatStamp(ms: number, timeZone: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  })
    .format(new Date(ms))
    .replace(",", "");
}

// "in 3 days", "in 5 hours", "2 hours ago".
export function relativeToNow(ms: number, now: number): string {
  const diff = ms - now;
  const abs = Math.abs(diff);
  const minutes = Math.round(abs / 60_000);
  const hours = Math.round(abs / 3_600_000);
  const days = Math.round(abs / 86_400_000);
  const amount =
    minutes < 60
      ? `${Math.max(minutes, 1)} minute${minutes === 1 ? "" : "s"}`
      : hours < 48
        ? `${hours} hour${hours === 1 ? "" : "s"}`
        : `${days} days`;
  return diff >= 0 ? `in ${amount}` : `${amount} ago`;
}

export type Urgency = "passed" | "today" | "soon" | "later";

// The countdown students see next to a deadline: "2 days 5 h left",
// "45 min left", "Deadline passed 3 hours ago". Under a day it is "today";
// under three days, "soon".
export function timeLeft(
  dueAt: number,
  now: number,
): { text: string; urgency: Urgency } {
  const diff = dueAt - now;
  if (diff <= 0) {
    return {
      text: `Deadline passed ${relativeToNow(dueAt, now)}`,
      urgency: "passed",
    };
  }
  const minutes = Math.max(1, Math.floor(diff / 60_000));
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  if (hours < 1) return { text: `${minutes} min left`, urgency: "today" };
  if (days < 1) {
    const m = minutes % 60;
    return {
      text: m ? `${hours} h ${m} min left` : `${hours} h left`,
      urgency: "today",
    };
  }
  const h = hours % 24;
  const dayText = `${days} ${days === 1 ? "day" : "days"}`;
  if (days < 3) {
    return { text: h ? `${dayText} ${h} h left` : `${dayText} left`, urgency: "soon" };
  }
  return { text: `${dayText} left`, urgency: "later" };
}
