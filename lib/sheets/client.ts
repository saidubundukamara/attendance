import { google, type sheets_v4 } from "googleapis";
import { isAttendanceTab } from "./parse";
import type { CellWrite } from "./write";

const SCOPES = ["https://www.googleapis.com/auth/spreadsheets"];

let cached: sheets_v4.Sheets | undefined;

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing environment variable ${name}`);
  return value;
}

export function getSpreadsheetId(): string {
  return requireEnv("GOOGLE_SHEET_ID");
}

export function getSheetsClient(): sheets_v4.Sheets {
  if (cached) return cached;
  const auth = new google.auth.JWT({
    email: requireEnv("GOOGLE_SERVICE_ACCOUNT_EMAIL"),
    // .env files store the key on one line with literal \n sequences.
    key: requireEnv("GOOGLE_PRIVATE_KEY").replace(/\\n/g, "\n"),
    scopes: SCOPES,
  });
  cached = google.sheets({ version: "v4", auth });
  return cached;
}

// A1 range covering a whole tab. Quotes in the title are doubled.
export function tabRange(title: string): string {
  return `'${title.replace(/'/g, "''")}'`;
}

export async function listAttendanceTabs(): Promise<string[]> {
  const res = await getSheetsClient().spreadsheets.get({
    spreadsheetId: getSpreadsheetId(),
    fields: "sheets.properties.title",
  });
  return (res.data.sheets ?? [])
    .map((sheet) => sheet.properties?.title ?? "")
    .filter(isAttendanceTab);
}

// Raw cell values for each tab, in the order given. Numbers stay numbers.
export async function fetchTabValues(
  titles: string[],
): Promise<{ title: string; values: unknown[][] }[]> {
  if (titles.length === 0) return [];
  const res = await getSheetsClient().spreadsheets.values.batchGet({
    spreadsheetId: getSpreadsheetId(),
    ranges: titles.map(tabRange),
    valueRenderOption: "UNFORMATTED_VALUE",
  });
  const ranges = res.data.valueRanges ?? [];
  return titles.map((title, i) => ({
    title,
    values: (ranges[i]?.values ?? []) as unknown[][],
  }));
}

// 0-based column index -> A1 letters (0 -> A, 26 -> AA).
export function columnLetter(index: number): string {
  let letters = "";
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) {
    letters = String.fromCharCode(65 + ((n - 1) % 26)) + letters;
  }
  return letters;
}

export function cellRange(cell: Pick<CellWrite, "tab" | "row" | "col">): string {
  return `${tabRange(cell.tab)}!${columnLetter(cell.col)}${cell.row + 1}`;
}

// Writes all cells in one request. RAW keeps 1 and 0 as numbers so the
// sheet's Total formula keeps summing them.
export async function writeCells(cells: CellWrite[]): Promise<void> {
  if (cells.length === 0) return;
  await getSheetsClient().spreadsheets.values.batchUpdate({
    spreadsheetId: getSpreadsheetId(),
    requestBody: {
      valueInputOption: "RAW",
      data: cells.map((cell) => ({
        range: cellRange(cell),
        values: [[cell.value]],
      })),
    },
  });
}
