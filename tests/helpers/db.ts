import { migrate } from "drizzle-orm/libsql/migrator";
import { openDatabase } from "@/lib/db/client";

// Fresh in-memory database with the real migrations applied.
export async function createTestDb() {
  const db = openDatabase(":memory:");
  await migrate(db, { migrationsFolder: "./drizzle" });
  return db;
}
