import { databaseConfig, openDatabase, type Db } from "./client";

export * as schema from "./schema";
export type { Db };

// Kept on globalThis so dev hot-reload reuses one connection.
const globalForDb = globalThis as unknown as { __attendanceDb?: Db };

function connect(): Db {
  const { url, authToken } = databaseConfig();
  return openDatabase(url, authToken);
}

export const db: Db = globalForDb.__attendanceDb ?? connect();

if (process.env.NODE_ENV !== "production") {
  globalForDb.__attendanceDb = db;
}
