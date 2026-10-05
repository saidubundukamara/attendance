// Builds cell values shaped like an "Attn of <CLASS>" tab: info block in
// rows 2-7, header in row 10, students from row 11. All data is made up.

export type FixtureStudent = { name?: string; id?: unknown };

export function buildTab(
  studentRows: FixtureStudent[],
  options: { weeks?: number; moduleName?: string; moduleCode?: string } = {},
): unknown[][] {
  const weeks = options.weeks ?? 15;
  const values: unknown[][] = [];
  values[1] = [];
  values[2] = pad(4, ["MODULE NAME: ", "", options.moduleName ?? "Test Module"]);
  values[3] = pad(4, ["MODULE CODE: ", "", options.moduleCode ?? "TEST101"]);
  values[4] = pad(4, ["SEMESTER", "", 3]);
  values[5] = pad(4, ["LECTURER: ", "", "A. Lecturer"]);
  values[8] = ["", "", "Class:", "WRONG 9999"];
  values[9] = [
    "",
    "No.",
    "Name",
    "ID Number",
    ...Array.from({ length: weeks }, (_, i) => `WK${i + 1}`),
    "Total ",
    "REASON",
  ];
  studentRows.forEach((student, i) => {
    values.push([
      "",
      i + 1,
      student.name ?? "",
      student.id ?? "",
      ...Array.from({ length: weeks }, () => 0),
      0,
    ]);
  });
  // Sparse rows arrive from the API as empty arrays.
  return Array.from(values, (row) => row ?? []);
}

function pad(count: number, cells: unknown[]): unknown[] {
  return [...Array.from({ length: count }, () => ""), ...cells];
}
