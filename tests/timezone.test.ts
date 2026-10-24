import { describe, expect, it } from "vitest";
import { localInputToMs, msToLocalInput, timeLeft } from "@/lib/timezone";

describe("deadline time zones", () => {
  it("reads a typed deadline in the college's zone", () => {
    expect(localInputToMs("2026-10-30T23:59", "Africa/Freetown")).toBe(
      Date.UTC(2026, 9, 30, 23, 59),
    );
    expect(localInputToMs("2026-10-30T23:59", "Africa/Lagos")).toBe(
      Date.UTC(2026, 9, 30, 22, 59),
    );
  });

  it("handles daylight saving and round-trips through the input format", () => {
    const ms = localInputToMs("2026-07-01T09:15", "Europe/London");
    expect(ms).toBe(Date.UTC(2026, 6, 1, 8, 15));
    expect(msToLocalInput(ms as number, "Europe/London")).toBe("2026-07-01T09:15");
  });

  it("rejects impossible dates", () => {
    expect(localInputToMs("2026-02-30T10:00", "Africa/Freetown")).toBeNull();
    expect(localInputToMs("tomorrow", "Africa/Freetown")).toBeNull();
  });
});

describe("timeLeft", () => {
  const now = Date.UTC(2026, 9, 24, 12, 0);
  const M = 60_000;
  const H = 60 * M;
  it("counts down with rising urgency", () => {
    expect(timeLeft(now + 10 * 24 * H, now)).toEqual({ text: "10 days left", urgency: "later" });
    expect(timeLeft(now + 2 * 24 * H + 5 * H, now)).toEqual({ text: "2 days 5 h left", urgency: "soon" });
    expect(timeLeft(now + 24 * H, now)).toEqual({ text: "1 day left", urgency: "soon" });
    expect(timeLeft(now + 5 * H + 20 * M, now)).toEqual({ text: "5 h 20 min left", urgency: "today" });
    expect(timeLeft(now + 45 * M, now)).toEqual({ text: "45 min left", urgency: "today" });
    expect(timeLeft(now + 20 * 1000, now)).toEqual({ text: "1 min left", urgency: "today" });
  });

  it("says when the deadline has passed", () => {
    expect(timeLeft(now - 3 * H, now)).toEqual({
      text: "Deadline passed 3 hours ago",
      urgency: "passed",
    });
  });
});
