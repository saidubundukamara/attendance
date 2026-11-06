import { google, type sheets_v4 } from "googleapis";
import { googleAuthFor, noteGoogleFailure } from "@/lib/google/auth";
import type { Lecturer } from "@/lib/lecturers";
import { isAttendanceTab } from "./parse";
import type { CellWrite } from "./write";

// One lecturer's attendance spreadsheet. With the drive.file scope the app
// can only open a spreadsheet the lecturer picked in the Google Picker.
export type SheetCtx = {
  lecturerId: number;
  sheets: sheets_v4.Sheets;
  spreadsheetId: string;
};

export class NoSheetError extends Error {
  constructor() {
    super("No Google Sheet is connected yet. Pick one on the setup page.");
    this.name = "NoSheetError";
  }
}

export function sheetCtxFor(
  lecturer: Pick<Lecturer, "id" | "refreshTokenEnc" | "sheetId">,
): SheetCtx {
  if (!lecturer.sheetId) throw new NoSheetError();
  return {
    lecturerId: lecturer.id,
    sheets: google.sheets({ version: "v4", auth: googleAuthFor(lecturer) }),
    spreadsheetId: lecturer.sheetId,
  };
}

// Runs a Sheets call, noting a revoked Google grant on the lecturer.
async function call<T>(ctx: SheetCtx, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    return noteGoogleFailure(ctx.lecturerId, error);
  }
}

// A1 range covering a whole tab. Quotes in the title are doubled.
export function tabRange(title: string): string {
  return `'${title.replace(/'/g, "''")}'`;
}

// The spreadsheet's name, which also proves the app can open it.
export async function getSpreadsheetTitle(ctx: SheetCtx): Promise<string> {
  const res = await call(ctx, () =>
    ctx.sheets.spreadsheets.get({
      spreadsheetId: ctx.spreadsheetId,
      fields: "properties.title",
    }),
  );
  return res.data.properties?.title ?? "";
}

export async function listAttendanceTabs(ctx: SheetCtx): Promise<string[]> {
  const res = await call(ctx, () =>
    ctx.sheets.spreadsheets.get({
      spreadsheetId: ctx.spreadsheetId,
      fields: "sheets.properties.title",
    }),
  );
  return (res.data.sheets ?? [])
    .map((sheet) => sheet.properties?.title ?? "")
    .filter(isAttendanceTab);
}

// Raw cell values for each tab, in the order given. Numbers stay numbers.
export async function fetchTabValues(
  ctx: SheetCtx,
  titles: string[],
): Promise<{ title: string; values: unknown[][] }[]> {
  if (titles.length === 0) return [];
  const res = await call(ctx, () =>
    ctx.sheets.spreadsheets.values.batchGet({
      spreadsheetId: ctx.spreadsheetId,
      ranges: titles.map(tabRange),
      valueRenderOption: "UNFORMATTED_VALUE",
    }),
  );
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
export async function writeCells(
  ctx: SheetCtx,
  cells: CellWrite[],
): Promise<void> {
  if (cells.length === 0) return;
  await call(ctx, () =>
    ctx.sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: ctx.spreadsheetId,
      requestBody: {
        valueInputOption: "RAW",
        data: cells.map((cell) => ({
          range: cellRange(cell),
          values: [[cell.value]],
        })),
      },
    }),
  );
}

// Adds a tab with a frozen header row unless one with that title exists.
export async function ensureTab(ctx: SheetCtx, title: string): Promise<void> {
  const { sheets, spreadsheetId } = ctx;
  const res = await call(ctx, () =>
    sheets.spreadsheets.get({
      spreadsheetId,
      fields: "sheets.properties.title",
    }),
  );
  const exists = (res.data.sheets ?? []).some(
    (sheet) => sheet.properties?.title === title,
  );
  if (exists) return;
  await call(ctx, () =>
    sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [
          {
            addSheet: {
              properties: {
                title,
                gridProperties: { frozenRowCount: 1, frozenColumnCount: 2 },
              },
            },
          },
        ],
      },
    }),
  );
}

// Clears the tab and writes `values` from A1. Only for tabs the app owns.
export async function replaceTabValues(
  ctx: SheetCtx,
  title: string,
  values: string[][],
): Promise<void> {
  const { sheets, spreadsheetId } = ctx;
  await call(ctx, () =>
    sheets.spreadsheets.values.clear({
      spreadsheetId,
      range: tabRange(title),
    }),
  );
  await call(ctx, () =>
    sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${tabRange(title)}!A1`,
      valueInputOption: "RAW",
      requestBody: { values },
    }),
  );
}

// The sheet access the sync code takes, bound to one lecturer's sheet.
export function sheetIo(ctx: SheetCtx) {
  return {
    fetchTabValues: (titles: string[]) => fetchTabValues(ctx, titles),
    writeCells: (cells: CellWrite[]) => writeCells(ctx, cells),
    ensureTab: (title: string) => ensureTab(ctx, title),
    replaceTabValues: (title: string, values: string[][]) =>
      replaceTabValues(ctx, title, values),
  };
}
