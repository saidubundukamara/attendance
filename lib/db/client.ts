import fs from "node:fs";
import path from "node:path";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import * as schema from "./schema";

export type Db = ReturnType<typeof openDatabase>;

// `url` is a Turso address (libsql://...) or a local file (file:./data/x.db).
export function openDatabase(url: string, authToken?: string) {
  if (url.startsWith("file:")) {
    const file = url.slice("file:".length);
    fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  }
  return drizzle(createClient({ url, authToken }), { schema });
}

// Turso when TURSO_DATABASE_URL is set (required on Vercel, where the disk
// is read-only); otherwise a local SQLite file for development.
export function databaseConfig(): { url: string; authToken?: string } {
  if (process.env.TURSO_DATABASE_URL) {
    return {
      url: process.env.TURSO_DATABASE_URL,
      authToken: process.env.TURSO_AUTH_TOKEN,
    };
  }
  return { url: `file:${process.env.DATABASE_PATH ?? "./data/attendance.db"}` };
}
