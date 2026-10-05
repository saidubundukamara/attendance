import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { openDatabase } from "@/lib/db/client";

// Fresh in-memory database with the real migrations applied.
export function createTestDb() {
  const db = openDatabase(":memory:");
  migrate(db, { migrationsFolder: "./drizzle" });
  return db;
}
