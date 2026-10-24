import { describe, expect, it } from "vitest";
import { localInputToMs, msToLocalInput } from "@/lib/timezone";

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
