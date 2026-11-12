import { describe, expect, it } from "vitest";
import {
  acceptsSubmissions,
  itemStatus,
  latePolicy,
  shiftCutoff,
} from "@/lib/late-window";

const DUE = 1_800_000_000_000;
const DAY = 86_400_000;
const TZ = "Africa/Freetown";

describe("late window", () => {
  it("reads the policy from the cutoff", () => {
    expect(latePolicy({ dueAt: DUE, closesAt: null })).toBe("UNTIL_CLOSED");
    expect(latePolicy({ dueAt: DUE, closesAt: DUE })).toBe("NONE");
    expect(latePolicy({ dueAt: DUE, closesAt: DUE + DAY })).toBe("UNTIL");
  });

  it("takes work until the cutoff, and never once closed by hand", () => {
    const item = { open: true, dueAt: DUE, closesAt: DUE + DAY };
    expect(acceptsSubmissions(item, DUE + DAY)).toBe(true);
    expect(acceptsSubmissions(item, DUE + DAY + 1)).toBe(false);
    expect(acceptsSubmissions({ ...item, closesAt: null }, DUE + 99 * DAY)).toBe(true);
    expect(acceptsSubmissions({ ...item, open: false }, DUE - DAY)).toBe(false);
  });

  it("moves the cutoff with the deadline", () => {
    expect(shiftCutoff(null, DUE, DUE + DAY)).toBeNull();
    expect(shiftCutoff(DUE, DUE, DUE + DAY)).toBe(DUE + DAY);
    expect(shiftCutoff(DUE + 2 * DAY, DUE, DUE + DAY)).toBe(DUE + 3 * DAY);
  });

  it("describes where an item stands", () => {
    const item = { open: true, dueAt: DUE, closesAt: DUE + DAY };
    expect(itemStatus(item, DUE - DAY, TZ).text).toBe("Open");
    expect(itemStatus(item, DUE + 1, TZ)).toMatchObject({ tone: "warn" });
    expect(itemStatus(item, DUE + 1, TZ).text).toMatch(/until/);
    expect(itemStatus(item, DUE + 2 * DAY, TZ).text).toMatch(/^Closed /);
    expect(itemStatus({ ...item, open: false }, DUE, TZ).text).toBe("Closed");
  });
});
