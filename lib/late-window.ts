import { formatDeadline, relativeToNow } from "@/lib/timezone";

// How an item handles work that comes in after the deadline. Stored as
// `closesAt`: null takes late work until the lecturer closes the item, a
// value equal to `dueAt` takes none, and anything later takes it until then.
export type LatePolicy = "UNTIL_CLOSED" | "NONE" | "UNTIL";

type Window = { open: boolean; dueAt: number; closesAt: number | null };

export function latePolicy(item: Omit<Window, "open">): LatePolicy {
  if (item.closesAt === null) return "UNTIL_CLOSED";
  return item.closesAt <= item.dueAt ? "NONE" : "UNTIL";
}

// Closed by the lecturer, or past the late-work cutoff.
export function acceptsSubmissions(item: Window, now: number): boolean {
  return item.open && (item.closesAt === null || now <= item.closesAt);
}

// Closed by the cutoff rather than by hand.
export function closedByCutoff(item: Window, now: number): boolean {
  return item.open && item.closesAt !== null && now > item.closesAt;
}

// When the deadline moves, the cutoff moves with it, so "no late work" and
// "two days' grace" keep meaning the same thing.
export function shiftCutoff(
  closesAt: number | null,
  oldDueAt: number,
  newDueAt: number,
): number | null {
  return closesAt === null ? null : closesAt + (newDueAt - oldDueAt);
}

export type ItemStatus = { text: string; tone: "ok" | "warn" | "muted" };

// Where an item stands, for the lecturer's pages. `detailed` adds how long
// is left, for the item's own page.
export function itemStatus(
  item: Window,
  now: number,
  timeZone: string,
  detailed = false,
): ItemStatus {
  if (!item.open) return { text: "Closed", tone: "muted" };
  if (item.closesAt !== null && now > item.closesAt) {
    return {
      text: `Closed ${formatDeadline(item.closesAt, timeZone)}`,
      tone: "muted",
    };
  }
  const until =
    item.closesAt === null
      ? ""
      : ` until ${formatDeadline(item.closesAt, timeZone)}`;
  if (now > item.dueAt) {
    return { text: `Deadline passed · accepting late work${until}`, tone: "warn" };
  }
  if (!detailed) return { text: "Open", tone: "ok" };
  return latePolicy(item) === "NONE"
    ? { text: `Open · closes ${relativeToNow(item.dueAt, now)}, no late work`, tone: "ok" }
    : { text: `Open · due ${relativeToNow(item.dueAt, now)}`, tone: "ok" };
}
