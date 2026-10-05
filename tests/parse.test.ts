import { describe, expect, it } from "vitest";
import {
  classCodeFromTab,
  isAttendanceTab,
  normalizeStudentId,
  parseAttendanceTab,
} from "@/lib/sheets/parse";
import { buildTab } from "./helpers/sheet";

describe("tab names", () => {
  it("recognises attendance tabs and ignores grade tabs", () => {
    expect(isAttendanceTab("Attn of BSEM1201")).toBe(true);
    expect(isAttendanceTab("attn of  BBIT2101")).toBe(true);
    expect(isAttendanceTab("BSEM1201")).toBe(false);
  });

  it("takes the class code from the tab name", () => {
    expect(classCodeFromTab("Attn of BSEM1201")).toBe("BSEM1201");
    expect(classCodeFromTab(" attn of  BBIT2101 ")).toBe("BBIT2101");
  });
});

describe("normalizeStudentId", () => {
  it("turns numeric and decimal-looking IDs into plain strings", () => {
    expect(normalizeStudentId(905005069)).toBe("905005069");
    expect(normalizeStudentId("905005069.0")).toBe("905005069");
    expect(normalizeStudentId(" 905005069 ")).toBe("905005069");
    expect(normalizeStudentId("")).toBe("");
    expect(normalizeStudentId(undefined)).toBe("");
  });
});

describe("parseAttendanceTab", () => {
  it("parses the standard layout", () => {
    const parsed = parseAttendanceTab(
      buildTab([
        { name: "Student One", id: 900000001 },
        { name: "Student Two", id: 900000002 },
      ]),
    );
    expect(parsed.headerRow).toBe(9);
    expect(parsed.nameCol).toBe(2);
    expect(parsed.idCol).toBe(3);
    expect(parsed.weekCols.size).toBe(15);
    expect(parsed.weekCols.get(1)).toBe(4);
    expect(parsed.weekCols.get(15)).toBe(18);
    expect(parsed.moduleName).toBe("Test Module");
    expect(parsed.moduleCode).toBe("TEST101");
    expect(parsed.students).toEqual([
      { studentId: "900000001", name: "Student One", row: 10 },
      { studentId: "900000002", name: "Student Two", row: 11 },
    ]);
    expect(parsed.warnings).toEqual([]);
  });

  it("finds the header on a different row with shifted columns", () => {
    const values = buildTab([{ name: "Student One", id: 900000001 }]).map(
      (row) => (row.length ? ["", "", ...row] : row),
    );
    values.unshift([], [], []);
    const parsed = parseAttendanceTab(values);
    expect(parsed.headerRow).toBe(12);
    expect(parsed.idCol).toBe(5);
    expect(parsed.weekCols.get(1)).toBe(6);
    expect(parsed.students[0]).toEqual({
      studentId: "900000001",
      name: "Student One",
      row: 13,
    });
  });

  it("maps weeks by header text when they are out of order", () => {
    const values = buildTab([], { weeks: 3 });
    values[9] = ["", "No.", "Name", "ID Number", "WK3", "wk 1", "WK2"];
    const parsed = parseAttendanceTab(values);
    expect([...parsed.weekCols.entries()].sort()).toEqual([
      [1, 5],
      [2, 6],
      [3, 4],
    ]);
  });

  it("skips numbered rows that have no ID", () => {
    const parsed = parseAttendanceTab(
      buildTab([{}, { name: "Student One", id: 900000001 }, {}]),
    );
    expect(parsed.students.map((s) => s.studentId)).toEqual(["900000001"]);
    expect(parsed.warnings).toEqual([]);
  });

  it("keeps the first of a duplicated ID and warns", () => {
    const parsed = parseAttendanceTab(
      buildTab([
        { name: "Student One", id: 900000001 },
        { name: "Copy", id: "900000001.0" },
      ]),
    );
    expect(parsed.students).toHaveLength(1);
    expect(parsed.students[0].name).toBe("Student One");
    expect(parsed.warnings).toEqual([
      "Row 12: duplicate ID 900000001; first occurrence kept.",
    ]);
  });

  it("skips malformed IDs and warns", () => {
    const parsed = parseAttendanceTab(
      buildTab([
        { name: "Bad", id: "ABC123" },
        { name: "Short", id: 12 },
      ]),
    );
    expect(parsed.students).toEqual([]);
    expect(parsed.warnings).toHaveLength(2);
  });

  it("imports a student without a name and warns", () => {
    const parsed = parseAttendanceTab(buildTab([{ id: 900000001 }]));
    expect(parsed.students).toEqual([
      { studentId: "900000001", name: "", row: 10 },
    ]);
    expect(parsed.warnings).toEqual(["Row 11: ID 900000001 has no name."]);
  });

  it("returns a warning instead of throwing when there is no header", () => {
    const parsed = parseAttendanceTab([["something"], [], ["else", 1]]);
    expect(parsed.headerRow).toBeNull();
    expect(parsed.students).toEqual([]);
    expect(parsed.warnings).toHaveLength(1);
    expect(parseAttendanceTab([]).headerRow).toBeNull();
  });
});
