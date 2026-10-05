import { describe, expect, it } from "vitest";
import { isIsoDate, suggestWeek } from "@/lib/week";

const day = (iso: string, hour = 9) => {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d, hour);
};

describe("suggestWeek", () => {
  const start = "2026-09-07";

  it("is week 1 on the start date and for the six days after", () => {
    expect(suggestWeek(start, day("2026-09-07"), 15)).toBe(1);
    expect(suggestWeek(start, day("2026-09-13", 23), 15)).toBe(1);
  });

  it("moves to the next week every seven days", () => {
    expect(suggestWeek(start, day("2026-09-14", 0), 15)).toBe(2);
    expect(suggestWeek(start, day("2026-10-05"), 15)).toBe(5);
  });

  it("clamps before the start and after the last week", () => {
    expect(suggestWeek(start, day("2026-08-01"), 15)).toBe(1);
    expect(suggestWeek(start, day("2027-06-01"), 15)).toBe(15);
  });

  it("returns null without a usable start date", () => {
    expect(suggestWeek(null, day("2026-09-07"), 15)).toBeNull();
    expect(suggestWeek("not-a-date", day("2026-09-07"), 15)).toBeNull();
  });
});

describe("isIsoDate", () => {
  it("accepts real dates only", () => {
    expect(isIsoDate("2026-09-07")).toBe(true);
    expect(isIsoDate("2026-02-30")).toBe(false);
    expect(isIsoDate("07/09/2026")).toBe(false);
    expect(isIsoDate("")).toBe(false);
  });
});
