// Pure parsing of an "Attn of <CLASS>" tab. No network or database access.
// Everything is located by header text, never by fixed cell address.

export const ATTENDANCE_TAB_PREFIX = /^attn\s+of\s+/i;

export type ParsedStudent = {
  studentId: string;
  name: string;
  // 0-based index into the values array (sheet row number minus one).
  row: number;
};

export type ParsedTab = {
  moduleName: string | null;
  moduleCode: string | null;
  // Null when the tab has no "ID Number" header; the tab is then unusable.
  headerRow: number | null;
  idCol: number | null;
  nameCol: number | null;
  // Week number -> 0-based column index.
  weekCols: Map<number, number>;
  students: ParsedStudent[];
  warnings: string[];
};

export function isAttendanceTab(title: string): boolean {
  return ATTENDANCE_TAB_PREFIX.test(title.trim());
}

// "Attn of BSEM1201" -> "BSEM1201"
export function classCodeFromTab(title: string): string {
  return title.trim().replace(ATTENDANCE_TAB_PREFIX, "").trim();
}

function cellText(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function normalizeLabel(value: unknown): string {
  return cellText(value).toLowerCase().replace(/\s+/g, " ");
}

// Sheet IDs are stored as numbers (905005069) and may arrive as "905005069.0".
// Returns "" for an empty cell.
export function normalizeStudentId(value: unknown): string {
  if (typeof value === "number") {
    return Number.isFinite(value) ? String(Math.trunc(value)) : "";
  }
  return cellText(value)
    .replace(/\.0+$/, "")
    .replace(/\s+/g, "");
}

export function isValidStudentId(id: string): boolean {
  return /^\d{4,12}$/.test(id);
}

function findInfoValue(
  values: unknown[][],
  beforeRow: number,
  label: string,
): string | null {
  for (let r = 0; r < beforeRow; r++) {
    const row = values[r] ?? [];
    for (let c = 0; c < row.length; c++) {
      if (!normalizeLabel(row[c]).startsWith(label)) continue;
      for (let next = c + 1; next < row.length; next++) {
        const text = cellText(row[next]);
        if (text) return text;
      }
      return null;
    }
  }
  return null;
}

export function parseAttendanceTab(values: unknown[][]): ParsedTab {
  const result: ParsedTab = {
    moduleName: null,
    moduleCode: null,
    headerRow: null,
    idCol: null,
    nameCol: null,
    weekCols: new Map(),
    students: [],
    warnings: [],
  };

  for (let r = 0; r < values.length; r++) {
    const idCol = (values[r] ?? []).findIndex(
      (cell) => normalizeLabel(cell) === "id number",
    );
    if (idCol !== -1) {
      result.headerRow = r;
      result.idCol = idCol;
      break;
    }
  }

  if (result.headerRow === null || result.idCol === null) {
    result.warnings.push('No "ID Number" header found; tab skipped.');
    return result;
  }

  const header = values[result.headerRow] ?? [];
  const idCol = result.idCol;

  const nameCol = header.findIndex((cell) => normalizeLabel(cell) === "name");
  result.nameCol = nameCol === -1 ? null : nameCol;
  if (result.nameCol === null) {
    result.warnings.push('No "Name" header found; names left blank.');
  }

  header.forEach((cell, col) => {
    const match = /^wk\s*(\d+)$/i.exec(cellText(cell));
    if (!match) return;
    const week = Number(match[1]);
    if (result.weekCols.has(week)) {
      result.warnings.push(`Week ${week} appears more than once; first used.`);
      return;
    }
    result.weekCols.set(week, col);
  });
  if (result.weekCols.size === 0) {
    result.warnings.push("No WK columns found.");
  }

  result.moduleName = findInfoValue(values, result.headerRow, "module name");
  result.moduleCode = findInfoValue(values, result.headerRow, "module code");

  const seen = new Set<string>();
  for (let r = result.headerRow + 1; r < values.length; r++) {
    const row = values[r] ?? [];
    const studentId = normalizeStudentId(row[idCol]);
    // Pre-numbered rows with no ID yet.
    if (!studentId) continue;

    const sheetRow = r + 1;
    if (!isValidStudentId(studentId)) {
      result.warnings.push(
        `Row ${sheetRow}: ID "${studentId}" is not 4-12 digits; skipped.`,
      );
      continue;
    }
    if (seen.has(studentId)) {
      result.warnings.push(
        `Row ${sheetRow}: duplicate ID ${studentId}; first occurrence kept.`,
      );
      continue;
    }
    seen.add(studentId);

    const name = result.nameCol === null ? "" : cellText(row[result.nameCol]);
    if (!name && result.nameCol !== null) {
      result.warnings.push(`Row ${sheetRow}: ID ${studentId} has no name.`);
    }
    result.students.push({ studentId, name, row: r });
  }

  return result;
}
