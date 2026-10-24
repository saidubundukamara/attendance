import { describe, expect, it } from "vitest";
import { buildSubmissionsGrid } from "@/lib/sheets/submissions";

const at = Date.UTC(2026, 9, 24, 14, 5);

describe("buildSubmissionsGrid", () => {
  it("puts one column per item and stamps each submission", () => {
    const grid = buildSubmissionsGrid(
      {
        columns: [
          { id: 1, title: "Assignment 1" },
          { id: 2, title: "Classwork - Week 5" },
        ],
        rows: [
          { id: 10, studentId: "905001111", name: "Ada" },
          { id: 11, studentId: "905002222", name: "Ben" },
        ],
        cells: new Map([
          ["10:1", { late: false, submittedAt: at }],
          ["11:2", { late: true, submittedAt: at }],
        ]),
      },
      "Africa/Freetown",
    );
    expect(grid).toEqual([
      ["ID Number", "Name", "Assignment 1", "Classwork - Week 5"],
      ["905001111", "Ada", "24 Oct 14:05", ""],
      ["905002222", "Ben", "", "LATE 24 Oct 14:05"],
    ]);
  });
});
